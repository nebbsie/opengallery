import { buildPlan, findSidecar, parseSidecar, type TakeoutEntry } from './takeout-plan';

// Realistic Takeout paths: two zips, an album whose JSON sits in the other
// zip, truncated sidecar names, "(1)" duplicates, an edited copy, a Live
// Photo, HEIC, the trash, and album photos repeated in their year folder.
const P = 'Takeout/Google Photos';
let z = 0;
const e = (path: string, size = 1000, zip = z): TakeoutEntry => ({ zip, path: `${P}/${path}`, size });

const zip0: TakeoutEntry[] = [
  e('Summer in Italy/metadata.json', 300),
  e('Summer in Italy/IMG_0001.JPG', 5000),
  e('Summer in Italy/IMG_0002.JPG', 6000),
  e('Photos from 2019/IMG_0001.JPG', 5000),
  e('Photos from 2019/IMG_0001.JPG.supplemental-metadata.json', 900),
  e('Photos from 2019/IMG_0003.jpg', 7000),
  e('Photos from 2019/IMG_0003.jpg.json', 900),
  e('Photos from 2019/IMG_0003(1).jpg', 7100),
  e('Photos from 2019/IMG_0003.jpg.supplemental-metadata(1).json', 900),
  e('Photos from 2019/PXL_20190704_183000123.PORTRAIT.jpg', 8000),
  e('Photos from 2019/PXL_20190704_183000123.PORTRAIT.jpg.supplemental-me.json', 900),
  e('Photos from 2019/IMG_0004-edited.jpg', 9000),
  e('Photos from 2019/IMG_0004.jpg', 8800),
  e('Photos from 2019/IMG_0004.jpg.supplemental-metadata.json', 900),
];
z = 1;
const zip1: TakeoutEntry[] = [
  e('Summer in Italy/IMG_0001.JPG.supplemental-metadata.json', 900),
  e('Summer in Italy/IMG_0002.JPG.supp.json', 900),
  e('Photos from 2020/IMG_1234.HEIC', 3000),
  e('Photos from 2020/IMG_1234.MP4', 2_000_000),
  e('Photos from 2020/IMG_1234.HEIC.supplemental-metadata.json', 900),
  e('Photos from 2020/IMG_5555.JPG', 4000),
  e('Photos from 2020/IMG_5555.MP4', 1_500_000),
  e('Photos from 2020/IMG_5555.JPG.supplemental-metadata.json', 900),
  e('Photos from 2020/VID_0001.mp4', 50_000_000),
  e('Photos from 2020/VID_0001.mp4.supplemental-metadata.json', 900),
  e('Trash/IMG_9999.jpg', 1000),
  e('Photos from 2020/notes.txt', 10),
  e('Photos from 2020/empty.jpg', 0),
  { zip: 1, path: 'Takeout/Drive/report.jpg', size: 100 },
  e('Holiday 2018/metadata.json', 200),
  e('Holiday 2018/DSC_0001.NEF', 25_000_000),
];

describe('takeout-plan', () => {
  const plan = buildPlan([...zip0, ...zip1]);
  const byPath = new Map(plan.items.map((i) => [i.entry.path.slice(P.length + 1), i]));
  const jsonOf = (p: string) => byPath.get(p)?.json?.path.slice(P.length + 1) ?? null;

  it('puts album photos first, into the album folder', () => {
    expect(plan.items[0]!.kind).toBe('album');
    expect(byPath.get('Summer in Italy/IMG_0001.JPG')!.target).toBe('Summer in Italy');
    // A folder named like a year but with metadata.json is an album.
    expect(byPath.get('Holiday 2018/DSC_0001.NEF')!.kind).toBe('album');
    const firstYear = plan.items.findIndex((i) => i.kind === 'year');
    expect(plan.items.slice(firstYear).every((i) => i.kind === 'year')).toBe(true);
  });

  it('skips the year-folder copy of an album photo', () => {
    expect(byPath.has('Photos from 2019/IMG_0001.JPG')).toBe(false);
    expect(plan.skipped.find((s) => s.reason === 'in-album')?.count).toBe(1);
  });

  it('puts year-folder photos in a folder per year', () => {
    expect(byPath.get('Photos from 2019/IMG_0003.jpg')!.target).toBe('2019');
    expect(plan.years.map((y) => y.name)).toEqual(['2019', '2020']);
  });

  it('finds sidecars in another zip, truncated, and for duplicates', () => {
    expect(jsonOf('Summer in Italy/IMG_0001.JPG')).toBe('Summer in Italy/IMG_0001.JPG.supplemental-metadata.json');
    expect(byPath.get('Summer in Italy/IMG_0001.JPG')!.json!.zip).toBe(1);
    expect(jsonOf('Summer in Italy/IMG_0002.JPG')).toBe('Summer in Italy/IMG_0002.JPG.supp.json');
    expect(jsonOf('Photos from 2019/IMG_0003.jpg')).toBe('Photos from 2019/IMG_0003.jpg.json');
    expect(jsonOf('Photos from 2019/IMG_0003(1).jpg')).toBe(
      'Photos from 2019/IMG_0003.jpg.supplemental-metadata(1).json',
    );
    expect(jsonOf('Photos from 2019/PXL_20190704_183000123.PORTRAIT.jpg')).toBe(
      'Photos from 2019/PXL_20190704_183000123.PORTRAIT.jpg.supplemental-me.json',
    );
  });

  it('gives an edited copy the original JSON', () => {
    expect(jsonOf('Photos from 2019/IMG_0004-edited.jpg')).toBe(
      'Photos from 2019/IMG_0004.jpg.supplemental-metadata.json',
    );
  });

  it('imports HEIC and Live Photo videos next to their still', () => {
    expect(byPath.get('Photos from 2020/IMG_1234.HEIC')!.type).toBe('image');
    // Both halves of each Live Photo go to the same folder; the server pairs them.
    for (const n of ['IMG_1234.HEIC', 'IMG_1234.MP4', 'IMG_5555.JPG', 'IMG_5555.MP4']) {
      expect(byPath.get(`Photos from 2020/${n}`)!.target).toBe('2020');
    }
    expect(plan.livePhotos).toBe(2);
    // The video uses its still's JSON.
    expect(jsonOf('Photos from 2020/IMG_1234.MP4')).toBe('Photos from 2020/IMG_1234.HEIC.supplemental-metadata.json');
    // A long video with no still is not a Live Photo.
    expect(byPath.has('Photos from 2020/VID_0001.mp4')).toBe(true);
  });

  it('skips the trash, non-media and empty files', () => {
    const skip = Object.fromEntries(plan.skipped.map((s) => [s.reason, s.count]));
    expect(skip['trash']).toBe(1);
    expect(skip['empty']).toBe(1);
    expect(byPath.has('Photos from 2020/notes.txt')).toBe(false);
    expect(plan.items.some((i) => i.entry.path.startsWith('Takeout/Drive'))).toBe(false);
  });

  it('does not give an original the JSON of its (1) duplicate', () => {
    const jsons = new Map([['a.jpg.supplemental-metadata(1)', { zip: 0, path: 'x', size: 1 }]]);
    expect(findSidecar('a.jpg', jsons)).toBeNull();
  });

  it('parses the sidecar date, position and description', () => {
    const m = parseSidecar(
      JSON.stringify({
        photoTakenTime: { timestamp: '1562265000' },
        geoData: { latitude: 0, longitude: 0 },
        geoDataExif: { latitude: 45.43, longitude: 12.33 },
        description: ' Venice ',
      }),
    );
    expect(m.takenAt).toBe('2019-07-04T18:30:00.000Z');
    expect(m.lat).toBe(45.43);
    expect(m.lon).toBe(12.33);
    expect(m.description).toBe('Venice');
    expect(parseSidecar('not json').takenAt).toBeNull();
  });
});
