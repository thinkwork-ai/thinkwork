import { sql, threads } from "../../utils.js";

export function threadSearchPredicate(rawSearch: string) {
  const search = rawSearch.trim();
  const likeSearch = `%${escapeLike(search)}%`;

  return sql`(
    to_tsvector(
      'english'::regconfig,
      concat_ws(
        ' ',
        coalesce(${threads.title}, ''),
        coalesce(${threads.identifier}, ''),
        coalesce(${threads.description}, '')
      )
    ) @@ plainto_tsquery('english'::regconfig, ${search})
    OR ${threads.title} ILIKE ${likeSearch} ESCAPE '\\'
    OR ${threads.identifier} ILIKE ${likeSearch} ESCAPE '\\'
    OR ${threads.description} ILIKE ${likeSearch} ESCAPE '\\'
  )`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
