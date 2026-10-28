import { inject, Injectable } from '@angular/core';
import { CacheKey, FACE_CACHE_KEYS } from '@core/services/cache-key.types';
import { ToastService } from '@core/services/toast/toast';
import { injectTrpc } from '@core/services/trpc';
import { QueryClient } from '@tanstack/angular-query-experimental';

// Browse surfaces a hide can change: the server leaves out photos of hidden people.
const BROWSE_KEYS = [
  CacheKey.GalleryAll,
  CacheKey.GalleryPhotos,
  CacheKey.GalleryVideos,
  CacheKey.TimelineAll,
  CacheKey.TimelinePhotos,
  CacheKey.TimelineVideos,
  CacheKey.LocationAll,
  CacheKey.LocationSingle,
  CacheKey.CamerasAll,
  CacheKey.CameraSingle,
  CacheKey.YearsAll,
  CacheKey.YearSingle,
  CacheKey.YearTimeline,
  CacheKey.AlbumsAll,
  CacheKey.AlbumSingle,
];

export interface UndoHooks {
  // Runs after the server confirms the action.
  done?: () => void;
  // Runs after the user's Undo goes through.
  undone?: () => void;
}

// Admin face curation with toast feedback and an Undo action on each change.
// Each method refreshes every face cache once the server answers, so all open
// pages (People, person page, viewer chips, review queue) agree.
@Injectable({ providedIn: 'root' })
export class FaceActions {
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  private readonly toast = inject(ToastService);

  invalidateFaces(): void {
    for (const key of FACE_CACHE_KEYS) {
      void this.queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  invalidateBrowse(): void {
    for (const key of BROWSE_KEYS) {
      void this.queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  // Fold source into target. Returns false if the server refused.
  async merge(
    targetId: string,
    sourceId: string,
    message: string,
    hooks: UndoHooks = {},
  ): Promise<boolean> {
    let undoToken: string;
    try {
      ({ undoToken } = await this.trpc.faces.mergePeople.mutate({ targetId, sourceId }));
    } catch (err) {
      this.toast.error(errorText(err, 'Could not merge these people.'));
      return false;
    }
    this.invalidateFaces();
    hooks.done?.();
    this.toast.success(message, {
      action: {
        label: 'Undo',
        run: async () => {
          await this.trpc.faces.undoMerge.mutate({ undoToken });
          this.invalidateFaces();
          hooks.undone?.();
          this.toast.show('Merge undone');
        },
      },
    });
    return true;
  }

  // Hide a person and their photos for everyone.
  async hide(personId: string, name: string | null, hooks: UndoHooks = {}): Promise<boolean> {
    try {
      await this.trpc.faces.hidePerson.mutate({ id: personId, hidden: true });
    } catch (err) {
      this.toast.error(errorText(err, 'Could not hide this person.'));
      return false;
    }
    this.invalidateFaces();
    this.invalidateBrowse();
    hooks.done?.();
    this.toast.success(name ? `${name} is hidden` : 'Person hidden', {
      action: {
        label: 'Undo',
        run: async () => {
          await this.trpc.faces.unhidePerson.mutate(personId);
          this.invalidateFaces();
          this.invalidateBrowse();
          hooks.undone?.();
        },
      },
    });
    return true;
  }

  async unhide(personId: string, name: string | null): Promise<boolean> {
    try {
      await this.trpc.faces.unhidePerson.mutate(personId);
    } catch (err) {
      this.toast.error(errorText(err, 'Could not unhide this person.'));
      return false;
    }
    this.invalidateFaces();
    this.invalidateBrowse();
    this.toast.success(name ? `${name} is visible again` : 'Person visible again');
    return true;
  }

  // "Not this person": take the faces off their person. Undo puts them back.
  async removeFaces(faceIds: string[], name: string | null): Promise<boolean> {
    let undoToken: string;
    try {
      ({ undoToken } = await this.trpc.faces.removeFaces.mutate({ faceIds }));
    } catch (err) {
      this.toast.error(errorText(err, 'Could not remove these faces.'));
      return false;
    }
    this.invalidateFaces();
    const count = faceIds.length;
    this.toast.success(
      `${plural(count, 'face')} removed from ${name || 'this person'}`,
      { action: this.undoAction(undoToken) },
    );
    return true;
  }

  // "This is X": move faces to another person. Undo moves them back.
  async assignFaces(
    faceIds: string[],
    toPersonId: string,
    toName: string | null,
  ): Promise<boolean> {
    let undoToken: string;
    try {
      ({ undoToken } = await this.trpc.faces.assignFaces.mutate({ faceIds, personId: toPersonId }));
    } catch (err) {
      this.toast.error(errorText(err, 'Could not move these faces.'));
      return false;
    }
    this.invalidateFaces();
    this.toast.success(`${plural(faceIds.length, 'face')} moved to ${toName || 'an unnamed person'}`, {
      action: this.undoAction(undoToken),
    });
    return true;
  }

  // Split faces off into a new person. Undo moves them back.
  async createPerson(faceIds: string[]): Promise<string | null> {
    let personId: string;
    let undoToken: string;
    try {
      ({ personId, undoToken } = await this.trpc.faces.createPersonFromFaces.mutate({ faceIds }));
    } catch (err) {
      this.toast.error(errorText(err, 'Could not make a new person.'));
      return null;
    }
    this.invalidateFaces();
    this.toast.success(`New person made from ${plural(faceIds.length, 'face')}`, {
      action: this.undoAction(undoToken),
    });
    return personId;
  }

  // Undo of a face edit: the server restores the faces, their answers and any
  // person the edit deleted.
  undoAction(undoToken: string, undone?: () => void) {
    return {
      label: 'Undo',
      run: async () => {
        try {
          await this.trpc.faces.undoFaceEdit.mutate({ undoToken });
        } catch (err) {
          this.toast.error(errorText(err, 'Could not undo. The undo may have expired.'));
          return;
        }
        this.invalidateFaces();
        undone?.();
      },
    };
  }
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;
}

function errorText(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  return msg && msg !== 'TRPC request failed' ? msg : fallback;
}

// Alt text for a face crop.
export function faceAlt(name: string | null | undefined): string {
  return name ? `Face of ${name}` : 'Unnamed person';
}
