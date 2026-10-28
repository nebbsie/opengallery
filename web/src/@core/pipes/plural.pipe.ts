import { Pipe, PipeTransform } from '@angular/core';

// {{ n | plural: 'photo' }} -> "1 photo" / "2 photos". Pass the plural form when
// it is not the singular + "s": {{ n | plural: 'person' : 'people' }}.
@Pipe({ name: 'plural' })
export class PluralPipe implements PipeTransform {
  transform(count: number | null | undefined, singular: string, plural?: string): string {
    const n = count ?? 0;
    return `${n.toLocaleString()} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
  }
}
