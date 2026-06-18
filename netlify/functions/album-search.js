const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2/release";
const COVER_ART_API = "https://coverartarchive.org/release";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=900"
  },
  body: JSON.stringify(body)
});

const clean = (value) => String(value || "").trim();

const compactDateYear = (date) => {
  const match = clean(date).match(/^\d{4}/);
  return match ? match[0] : "";
};

const buildQuery = (album, artist) => {
  const parts = [];
  if (album) parts.push(`release:"${album.replace(/"/g, "")}"`);
  if (artist) parts.push(`artist:"${artist.replace(/"/g, "")}"`);
  return parts.join(" AND ") || album || artist;
};

const getCover = async (releaseId) => {
  try {
    const response = await fetch(`${COVER_ART_API}/${releaseId}`, {
      headers: {
        "User-Agent": "YuepingMusicReview/2.0 (https://netlify.app)"
      }
    });
    if (!response.ok) return "";
    const data = await response.json();
    const front = (data.images || []).find((image) => image.front) || data.images?.[0];
    return front?.thumbnails?.large || front?.thumbnails?.small || front?.image || "";
  } catch (error) {
    return "";
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const album = clean(event.queryStringParameters?.album);
  const artist = clean(event.queryStringParameters?.artist);
  if (!album && !artist) {
    return json(400, { error: "请输入专辑名或艺人名。" });
  }

  const url = new URL(MUSICBRAINZ_API);
  url.searchParams.set("query", buildQuery(album, artist));
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "6");
  url.searchParams.set("inc", "artist-credits+recordings");

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "YuepingMusicReview/2.0 (https://netlify.app)",
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return json(response.status, { error: "专辑数据库暂时不可用，请稍后再试。" });
    }

    const data = await response.json();
    const releases = data.releases || [];
    const results = await Promise.all(
      releases.map(async (release) => {
        const tracks = (release.media || [])
          .flatMap((medium) => medium.tracks || [])
          .map((track) => track.title)
          .filter(Boolean)
          .slice(0, 8);

        return {
          id: release.id,
          album: release.title || "",
          artist: (release["artist-credit"] || []).map((item) => item.name).filter(Boolean).join(" / "),
          year: compactDateYear(release.date),
          tracks,
          coverUrl: await getCover(release.id),
          sourceUrl: `https://musicbrainz.org/release/${release.id}`
        };
      })
    );

    return json(200, { results });
  } catch (error) {
    return json(500, { error: "搜索失败，请手动填写专辑信息。" });
  }
};
