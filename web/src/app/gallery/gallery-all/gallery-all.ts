import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { ErrorAlert } from '@core/components/error/error';
import { CacheKey } from '@core/services/cache-key.types';
import { injectTrpc } from '@core/services/trpc';
import { environment } from '@env/environment';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { Media } from '../../types/media';

@Component({
  selector: 'app-gallery-all',
  imports: [DatePipe, HlmSpinner, ErrorAlert, JsonPipe],
  template: `
    @if (files.isPending()) {
      <hlm-spinner />
    }

    @if (files.isError()) {
      <app-error-alert [error]="files.error()" />
    }

    @if (files.isSuccess()) {
      @for (asset of files.data(); track asset.id) {
        @if (asset.type === 'image') {
          <img [src]="apiUrl + '/asset/' + asset.id" [alt]="asset.id" />
        } @else if (asset.type === 'video') {
          <video [controls]="true" [src]="apiUrl + '/asset/' + asset.id"></video>
        }
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryAll {
  apiUrl = environment.api.url;

  private trpc = injectTrpc();

  files = injectQuery(() => ({
    queryKey: [CacheKey.GalleryAll],
    queryFn: async () => this.trpc.files.getAllFiles.query(),
  }));

  dbMedia = signal<Media[]>([
    {
      id: '1',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2025-08-19'),
    },
    {
      id: '2',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2025-08-19'),
    },
    {
      id: '3',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2025-08-19'),
    },
    {
      id: '4',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2025-08-19'),
    },

    {
      id: '5',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2010-01-10'),
    },
    {
      id: '6',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2010-01-10'),
    },
    {
      id: '7',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2010-01-10'),
    },
    {
      id: '8',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2010-01-10'),
    },
    {
      id: '9',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2010-01-10'),
    },
    {
      id: '10',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2010-01-10'),
    },

    {
      id: '11',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2001-06-01'),
    },
    {
      id: '12',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2001-06-01'),
    },
    {
      id: '13',
      type: 'image',
      location: 'https://placehold.co/200x200',
      date: new Date('2001-06-01'),
    },
  ]);

  // Utility: format date (YYYY-MM-DD)
  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  // Grouping function
  groupByDate(mediaList: Media[]): { key: string; value: Media[] }[] {
    const grouped = mediaList.reduce(
      (acc, item) => {
        const key = this.formatDate(item.date);
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      },
      {} as Record<string, Media[]>,
    );

    return Object.entries(grouped)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => (a.key < b.key ? 1 : -1)); // newest → oldest
  }

  groupedMedia = computed(() => this.groupByDate(this.dbMedia()));
}
