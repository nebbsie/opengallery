import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import {
  type AccessScope,
  buildFileAccessFilter,
  getAccessScope,
} from "../authz/shared-access.js";
import { db } from "../db/index.js";
import { hiddenPeopleFilter } from "../db/file-filters.js";
import {
  galleryOrderBy,
  keysetBefore,
  undatedBottomSortExpr,
} from "../db/file-sort.js";
import {
  AlbumFileTable,
  AlbumTable,
  FaceTable,
  FileTable,
  FileVariantTable,
  GeoLocationTable,
  ImageMetadataTable,
  LibraryFileTable,
  PersonTable,
  ViewerHiddenPersonTable,
} from "../db/schema.js";
import {
  boundingBox,
  type Place,
  PLACES,
  placeMatchesToken,
} from "../search/places.js";
import { privateProcedure, router } from "../trpc.js";

// ---------------------------------------------------------------------------
// Query parsing
//
// A query is split into words. Years ("2019") and month names ("june", "jun")
// become date filters. "video"/"videos" limits the kind. A few filler words
// are dropped. Every other word is a text token. For photos, the filters are
// combined with AND: each text token must match the photo through at least one
// of person name, album name, place, camera make/model or file path. So
// "steve 2019" gives photos with Steve that were taken in 2019.
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "from",
  "in",
  "of",
  "on",
  "the",
  "with",
  "by",
  "photo",
  "photos",
  "picture",
  "pictures",
  "pic",
  "pics",
  "image",
  "images",
]);
const VIDEO_WORDS = new Set([
  "video",
  "videos",
  "movie",
  "movies",
  "clip",
  "clips",
]);

type ParsedQuery = {
  years: number[];
  months: number[];
  kind: "all" | "video";
  tokens: string[];
};

export function parseQuery(raw: string): ParsedQuery {
  const words = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s,;]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);

  const parsed: ParsedQuery = {
    years: [],
    months: [],
    kind: "all",
    tokens: [],
  };
  for (const word of words) {
    if (/^(18|19|20)\d{2}$/.test(word)) {
      parsed.years.push(Number(word));
    } else if (word in MONTHS) {
      parsed.months.push(MONTHS[word]!);
    } else if (VIDEO_WORDS.has(word)) {
      parsed.kind = "video";
    } else if (!STOP_WORDS.has(word)) {
      parsed.tokens.push(word);
    }
  }
  parsed.years = [...new Set(parsed.years)].slice(0, 5);
  parsed.months = [...new Set(parsed.months)];
  parsed.tokens = [...new Set(parsed.tokens)].slice(0, 6);
  return parsed;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const likeAny = (column: SQL | SQLiteColumn, token: string) =>
  sql`${column} LIKE ${`%${escapeLike(token)}%`} ESCAPE '\\'`;
// Word-prefix match: "ste" matches "Steve" and "Mary Stevens", not "Kristen".
const likeWordPrefix = (column: SQL | SQLiteColumn, token: string) => {
  const t = escapeLike(token);
  return sql`(${column} LIKE ${`${t}%`} ESCAPE '\\' OR ${column} LIKE ${`% ${t}%`} ESCAPE '\\')`;
};

const cameraText = sql`(coalesce(${ImageMetadataTable.cameraMake}, '') || ' ' || coalesce(${ImageMetadataTable.cameraModel}, ''))`;
const pathText = sql`(${FileTable.dir} || '/' || ${FileTable.name})`;

// ---------------------------------------------------------------------------
// Entity lookups (all scoped to what this viewer may see)
// ---------------------------------------------------------------------------

type PersonHit = {
  id: string;
  name: string;
  coverFaceId: string | null;
  count: number;
};

// Named people the viewer may see whose name matches any token. Same rules as
// the People page: hidden people (global and per viewer) never show, and the
// count is of photos the viewer may see.
async function findPeople(
  scope: AccessScope,
  tokens: string[],
  limit: number,
): Promise<PersonHit[]> {
  if (tokens.length === 0) return [];
  if (scope.isAdmin && scope.accessibleLibraryIds.size === 0) return [];
  const nameMatch = or(
    ...tokens.map((t) => likeWordPrefix(PersonTable.name, t)),
  )!;
  const count = sql<number>`count(distinct ${FaceTable.fileId})`;
  const rows = await db
    .select({
      id: PersonTable.id,
      name: PersonTable.name,
      coverFaceId: sql<string | null>`coalesce(
        max(case when ${FaceTable.id} = ${PersonTable.coverFaceId} then ${FaceTable.id} end),
        min(case when ${FaceTable.cropName} is not null then ${FaceTable.id} end),
        min(${FaceTable.id})
      )`,
      count,
    })
    .from(PersonTable)
    .innerJoin(FaceTable, eq(FaceTable.personId, PersonTable.id))
    .where(
      and(
        sql`${PersonTable.name} IS NOT NULL`,
        eq(PersonTable.hidden, false),
        nameMatch,
        ...(scope.isAdmin
          ? [inArray(PersonTable.libraryId, [...scope.accessibleLibraryIds])]
          : [
              notInArray(
                PersonTable.id,
                db
                  .select({ personId: ViewerHiddenPersonTable.personId })
                  .from(ViewerHiddenPersonTable)
                  .where(
                    eq(ViewerHiddenPersonTable.viewerUserId, scope.userId),
                  ),
              ),
              buildFileAccessFilter(scope, FaceTable.fileId),
              exists(
                db
                  .select({ _: sql`1` })
                  .from(LibraryFileTable)
                  .where(
                    and(
                      eq(LibraryFileTable.fileId, FaceTable.fileId),
                      isNull(LibraryFileTable.deletedAt),
                    ),
                  ),
              ),
            ]),
      ),
    )
    .groupBy(PersonTable.id)
    .orderBy(desc(count))
    .limit(limit);
  return rows
    .filter((r) => r.count > 0)
    .map((r) => ({
      id: r.id,
      name: r.name ?? "",
      coverFaceId: r.coverFaceId,
      count: r.count,
    }));
}

// Albums the viewer may see whose name matches any token.
async function findAlbums(
  scope: AccessScope,
  tokens: string[],
  limit: number,
): Promise<
  Array<{
    id: string;
    name: string;
    cover: string | null;
    parentId: string | null;
  }>
> {
  const usable = tokens.filter((t) => t.length >= 2);
  if (usable.length === 0) return [];
  if (!scope.isAdmin && scope.visibleAlbumIds.size === 0) return [];
  return db
    .select({
      id: AlbumTable.id,
      name: AlbumTable.name,
      cover: AlbumTable.cover,
      parentId: AlbumTable.parentId,
    })
    .from(AlbumTable)
    .where(
      and(
        or(...usable.map((t) => likeAny(AlbumTable.name, t)))!,
        ...(scope.isAdmin
          ? []
          : [inArray(AlbumTable.id, [...scope.visibleAlbumIds])]),
      ),
    )
    .orderBy(sql`length(${AlbumTable.name})`, AlbumTable.name)
    .limit(limit);
}

// The album ids plus every descendant the viewer may see, so a match on a
// parent folder also finds the photos in its sub-folders.
async function withDescendants(
  scope: AccessScope,
  albumIds: string[],
): Promise<string[]> {
  const all = new Set(albumIds);
  let frontier = albumIds;
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const children = await db
      .select({ id: AlbumTable.id })
      .from(AlbumTable)
      .where(inArray(AlbumTable.parentId, frontier));
    frontier = children
      .map((c) => c.id)
      .filter(
        (id) =>
          !all.has(id) && (scope.isAdmin || scope.visibleAlbumIds.has(id)),
      );
    for (const id of frontier) all.add(id);
    if (all.size > 2000) break;
  }
  return [...all];
}

function findPlaces(tokens: string[]): Place[] {
  const usable = tokens.filter((t) => t.length >= 2);
  if (usable.length === 0) return [];
  return PLACES.filter((p) =>
    usable.some((t) => placeMatchesToken(p, t)),
  ).slice(0, 8);
}

const placeCondition = (place: Place, fileId: SQLiteColumn | SQL) => {
  const box = boundingBox(place.lat, place.lon, place.radiusKm);
  return exists(
    db
      .select({ _: sql`1` })
      .from(GeoLocationTable)
      .where(
        and(
          eq(GeoLocationTable.fileId, fileId),
          sql`${GeoLocationTable.lat} BETWEEN ${box.minLat} AND ${box.maxLat}`,
          sql`${GeoLocationTable.lon} BETWEEN ${box.minLon} AND ${box.maxLon}`,
        ),
      ),
  );
};

// Shared visibility rules for every photo list here. Same as the gallery:
// viewer access + per-viewer hide rules, admin-hidden people, and only files
// with both a thumbnail and an optimised variant.
async function visibleFileConditions(scope: AccessScope): Promise<SQL[]> {
  const hidden = await hiddenPeopleFilter(FileTable.id);
  return [
    buildFileAccessFilter(scope, FileTable.id),
    ...(hidden ? [hidden] : []),
    exists(
      db
        .select({ _: sql`1` })
        .from(FileVariantTable)
        .where(
          and(
            eq(FileVariantTable.originalFileId, FileTable.id),
            eq(FileVariantTable.type, "thumbnail"),
          ),
        ),
    ),
    exists(
      db
        .select({ _: sql`1` })
        .from(FileVariantTable)
        .where(
          and(
            eq(FileVariantTable.originalFileId, FileTable.id),
            eq(FileVariantTable.type, "optimised"),
          ),
        ),
    ),
  ];
}

function dateConditions(parsed: ParsedQuery): SQL[] {
  const conds: SQL[] = [];
  if (parsed.years.length > 0) {
    conds.push(
      or(
        ...parsed.years.map(
          (y) =>
            sql`(${FileTable.takenAt} >= ${`${y}-01-01`} AND ${FileTable.takenAt} < ${`${y + 1}-01-01`})`,
        ),
      )!,
    );
  }
  if (parsed.months.length > 0) {
    conds.push(
      inArray(
        sql`cast(strftime('%m', ${FileTable.takenAt}) as integer)`,
        parsed.months,
      ),
    );
  }
  return conds;
}

type TokenMatches = {
  token: string;
  people: PersonHit[];
  albumIds: string[];
  places: Place[];
};

async function resolveTokens(
  scope: AccessScope,
  tokens: string[],
): Promise<TokenMatches[]> {
  return Promise.all(
    tokens.map(async (token) => {
      const [people, albums] = await Promise.all([
        findPeople(scope, [token], 50),
        findAlbums(scope, [token], 200),
      ]);
      const albumIds =
        albums.length > 0
          ? await withDescendants(
              scope,
              albums.map((a) => a.id),
            )
          : [];
      return { token, people, albumIds, places: findPlaces([token]) };
    }),
  );
}

// One text token as a photo condition: OR across every way it can match.
function tokenCondition(match: TokenMatches): SQL {
  const ors: SQL[] = [
    likeAny(pathText, match.token),
    likeAny(cameraText, match.token),
  ];
  if (match.people.length > 0) {
    ors.push(
      exists(
        db
          .select({ _: sql`1` })
          .from(FaceTable)
          .where(
            and(
              eq(FaceTable.fileId, FileTable.id),
              inArray(
                FaceTable.personId,
                match.people.map((p) => p.id),
              ),
            ),
          ),
      ),
    );
  }
  if (match.albumIds.length > 0) {
    ors.push(
      exists(
        db
          .select({ _: sql`1` })
          .from(AlbumFileTable)
          .where(
            and(
              eq(AlbumFileTable.fileId, FileTable.id),
              inArray(AlbumFileTable.albumId, match.albumIds),
            ),
          ),
      ),
    );
  }
  for (const place of match.places)
    ors.push(placeCondition(place, FileTable.id));
  return or(...ors)!;
}

// A short human summary of how each part of the query was read, shown above
// the photo grid ("Steve", "2019").
function describe(parsed: ParsedQuery, matches: TokenMatches[]) {
  const chips: Array<{
    kind: "person" | "place" | "album" | "date" | "text" | "kind";
    label: string;
  }> = [];
  for (const m of matches) {
    if (m.people.length > 0)
      chips.push({ kind: "person", label: m.people[0]!.name });
    else if (m.places.length > 0)
      chips.push({ kind: "place", label: m.places[0]!.name });
    else if (m.albumIds.length > 0)
      chips.push({ kind: "album", label: m.token });
    else chips.push({ kind: "text", label: m.token });
  }
  const monthLabel = parsed.months.map((m) => MONTH_NAMES[m - 1]).join(" or ");
  const yearLabel = parsed.years.join(" or ");
  if (monthLabel || yearLabel) {
    chips.push({
      kind: "date",
      label: [monthLabel, yearLabel].filter(Boolean).join(" "),
    });
  }
  if (parsed.kind === "video") chips.push({ kind: "kind", label: "Videos" });
  const seen = new Set<string>();
  return chips.filter((c) => {
    const key = `${c.kind}:${c.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const queryInput = z.string().trim().max(200);

export const searchRouter = router({
  // Grouped results for the suggestion dropdown and the top of the results
  // page: People, Albums, Places, Cameras and the dates that were read.
  suggest: privateProcedure
    .input(
      z.object({
        q: queryInput,
        limit: z.number().int().min(1).max(20).default(6),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      return searchSuggest(await getAccessScope(userId, session), input);
    }),

  // Photos for the combined query, newest first, keyset paged like the gallery.
  photos: privateProcedure
    .input(
      z.object({
        q: queryInput,
        limit: z.number().int().positive().max(200).default(60),
        cursor: z.string().nullish(),
      }),
    )
    .query(async ({ ctx: { userId, session }, input }) => {
      if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
      return searchPhotos(await getAccessScope(userId, session), input);
    }),
});

export async function searchSuggest(
  scope: AccessScope,
  input: { q: string; limit: number },
) {
  const parsed = parseQuery(input.q);
  const { tokens } = parsed;
  const limit = input.limit;

  const [people, albumRows, cameras, places] = await Promise.all([
    findPeople(scope, tokens, limit),
    findAlbums(scope, tokens, limit),
    findCameras(scope, tokens, limit),
    countPlaces(scope, findPlaces(tokens), limit),
  ]);
  const albums = await albumDetails(scope, albumRows);

  const dates: Array<{
    label: string;
    year: number | null;
    month: number | null;
  }> = [];
  for (const year of parsed.years) {
    if (parsed.months.length === 0)
      dates.push({ label: String(year), year, month: null });
    for (const month of parsed.months) {
      dates.push({ label: `${MONTH_NAMES[month - 1]} ${year}`, year, month });
    }
  }
  if (parsed.years.length === 0) {
    for (const month of parsed.months) {
      dates.push({ label: MONTH_NAMES[month - 1]!, year: null, month });
    }
  }

  return {
    people,
    albums,
    places,
    cameras,
    dates,
    hasQuery:
      tokens.length > 0 ||
      parsed.years.length > 0 ||
      parsed.months.length > 0 ||
      parsed.kind !== "all",
  };
}

export async function searchPhotos(
  scope: AccessScope,
  input: { q: string; limit: number; cursor?: string | null | undefined },
) {
  const parsed = parseQuery(input.q);
  const empty =
    parsed.tokens.length === 0 &&
    parsed.years.length === 0 &&
    parsed.months.length === 0 &&
    parsed.kind === "all";
  if (empty) {
    return {
      items: [],
      nextCursor: null as string | null,
      filters: [] as ReturnType<typeof describe>,
    };
  }

  const [visible, matches] = await Promise.all([
    visibleFileConditions(scope),
    resolveTokens(scope, parsed.tokens),
  ]);

  const sortExpr = undatedBottomSortExpr;
  let cursorCondition: SQL | undefined;
  if (input.cursor && input.cursor.includes("|")) {
    const sep = input.cursor.lastIndexOf("|");
    cursorCondition = keysetBefore(
      sortExpr,
      input.cursor.slice(0, sep),
      input.cursor.slice(sep + 1),
    );
  }

  const rows = await db
    .select({
      file: FileTable,
      blurhash: ImageMetadataTable.blurhash,
      takenAt: ImageMetadataTable.takenAt,
      sortAt: sortExpr,
    })
    .from(FileTable)
    .innerJoin(ImageMetadataTable, eq(ImageMetadataTable.fileId, FileTable.id))
    .where(
      and(
        ...visible,
        ...(parsed.kind === "video" ? [eq(FileTable.type, "video")] : []),
        ...dateConditions(parsed),
        ...matches.map(tokenCondition),
        ...(cursorCondition ? [cursorCondition] : []),
      ),
    )
    .orderBy(...galleryOrderBy(sortExpr))
    .limit(input.limit + 1);

  const data = rows.map((r) => ({
    ...r.file,
    blurhash: r.blurhash,
    takenAt: r.takenAt,
    sortAt: r.sortAt,
  }));
  const hasMore = data.length > input.limit;
  const items = hasMore ? data.slice(0, input.limit) : data;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? `${last.sortAt}|${last.id}` : null,
    filters: describe(parsed, matches),
  };
}

async function findCameras(
  scope: AccessScope,
  tokens: string[],
  limit: number,
) {
  const usable = tokens.filter((t) => t.length >= 2);
  if (usable.length === 0) return [];
  const hidden = await hiddenPeopleFilter(ImageMetadataTable.fileId);
  const count = sql<number>`count(distinct ${ImageMetadataTable.fileId})`;
  const rows = await db
    .select({
      make: ImageMetadataTable.cameraMake,
      model: ImageMetadataTable.cameraModel,
      count,
    })
    .from(ImageMetadataTable)
    .where(
      and(
        sql`${ImageMetadataTable.cameraMake} IS NOT NULL`,
        sql`${ImageMetadataTable.cameraModel} IS NOT NULL`,
        or(...usable.map((t) => likeAny(cameraText, t)))!,
        buildFileAccessFilter(scope, ImageMetadataTable.fileId),
        ...(hidden ? [hidden] : []),
        exists(
          db
            .select({ _: sql`1` })
            .from(LibraryFileTable)
            .where(
              and(
                eq(LibraryFileTable.fileId, ImageMetadataTable.fileId),
                isNull(LibraryFileTable.deletedAt),
              ),
            ),
        ),
      ),
    )
    .groupBy(ImageMetadataTable.cameraMake, ImageMetadataTable.cameraModel)
    .orderBy(desc(count))
    .limit(limit);
  return rows.map((r) => ({ make: r.make!, model: r.model!, count: r.count }));
}

// Only places where the viewer has photos are returned, with a count and a
// cover photo.
async function countPlaces(scope: AccessScope, places: Place[], limit: number) {
  if (places.length === 0) return [];
  const visible = await visibleFileConditions(scope);
  const results = await Promise.all(
    places.map(async (place) => {
      const [row] = await db
        .select({
          count: sql<number>`count(*)`,
          cover: sql<
            string | null
          >`max(case when ${FileTable.type} = 'image' then ${FileTable.id} end)`,
        })
        .from(FileTable)
        .where(and(...visible, placeCondition(place, FileTable.id)));
      return {
        name: place.name,
        country: place.country,
        lat: place.lat,
        lon: place.lon,
        count: Number(row?.count ?? 0),
        cover: row?.cover ?? null,
      };
    }),
  );
  return results
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Cover and photo count per album, both limited to photos the viewer may see.
async function albumDetails(
  scope: AccessScope,
  albums: Array<{
    id: string;
    name: string;
    cover: string | null;
    parentId: string | null;
  }>,
) {
  if (albums.length === 0) return [];
  const ids = albums.map((a) => a.id);
  const covers = albums.map((a) => a.cover).filter((c): c is string => !!c);
  const [stats, okCovers] = await Promise.all([
    db
      .select({
        albumId: AlbumFileTable.albumId,
        items: sql<number>`count(distinct ${AlbumFileTable.fileId})`,
        firstImage: sql<
          string | null
        >`min(case when ${FileTable.type} = 'image' then ${FileTable.id} end)`,
      })
      .from(AlbumFileTable)
      .innerJoin(FileTable, eq(FileTable.id, AlbumFileTable.fileId))
      .where(
        and(
          inArray(AlbumFileTable.albumId, ids),
          buildFileAccessFilter(scope, FileTable.id),
          exists(
            db
              .select({ _: sql`1` })
              .from(FileVariantTable)
              .where(
                and(
                  eq(FileVariantTable.originalFileId, FileTable.id),
                  eq(FileVariantTable.type, "thumbnail"),
                ),
              ),
          ),
        ),
      )
      .groupBy(AlbumFileTable.albumId),
    covers.length > 0
      ? db
          .select({ id: FileTable.id })
          .from(FileTable)
          .where(
            and(
              inArray(FileTable.id, covers),
              buildFileAccessFilter(scope, FileTable.id),
            ),
          )
      : Promise.resolve([] as Array<{ id: string }>),
  ]);
  const byAlbum = new Map(stats.map((s) => [s.albumId, s]));
  const coverOk = new Set(okCovers.map((c) => c.id));
  return albums.map((a) => ({
    id: a.id,
    name: a.name,
    items: Number(byAlbum.get(a.id)?.items ?? 0),
    cover:
      (a.cover && coverOk.has(a.cover) ? a.cover : null) ??
      byAlbum.get(a.id)?.firstImage ??
      null,
  }));
}
