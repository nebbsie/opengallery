import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { Media } from '../../types/media';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-gallery-all',
  imports: [DatePipe],
  template: `
    <div>
      @for (dateGroup of groupedMedia(); track $index) {
        <p class="mb-2">{{ dateGroup.key | date: 'EEE, dd MMM yyyy' }}</p>
        <!--Mon, 18 Aug 2025-->

        <div class="mb-6 flex flex-wrap gap-x-2 gap-y-2">
          @for (media of dateGroup.value; track $index) {
            <img [src]="media.location" [alt]="media.id" />
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryAll {
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
