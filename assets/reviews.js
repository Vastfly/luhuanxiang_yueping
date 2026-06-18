(function () {
  const storageKey = "revue.reviews.v1";
  const config = window.REVUE_CONFIG || {};
  const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  const supabaseClient = hasSupabaseConfig
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

  const defaultReviews = [
    {
      id: "between-silence-and-space",
      title: "Between Silence and Space",
      album: "A Moment Apart",
      artist: "ODESZA",
      genre: "Electronic / Ambient",
      year: "2024",
      score: "9.2",
      author: "Alexandre Lefevre",
      published: "May 14, 2024",
      coverUrl: "",
      excerpt:
        "It arrives not with a statement, but with a breath. A Moment Apart creates the kind of space where silence becomes as expressive as sound.",
      body: [
        "It arrives not with a statement, but with a breath. A Moment Apart does not seek to fill the room; it creates the kind of space where silence becomes as expressive as sound.",
        "From the first ambient wash, the album establishes a world untethered from genre. It is not chillwave, not downtempo, not future bass, though it carries elements of all three. The record moves inward, building drama through restraint.",
        "The production is polished but never glossy. Percussion arrives like architecture: clean edges, long corridors, low lights. The melodies appear and recede with the patience of weather, asking the listener to lean closer instead of surrendering to spectacle.",
        "The record's luxury is not volume. It is distance, proportion, and the confidence to leave air around every sound.",
        "What makes the album linger is its sense of scale. Even at its most cinematic, it keeps a human figure somewhere in the frame: small, solitary, and visible against a wide dark horizon."
      ],
      tracks: ["Line of Sight", "Late Night", "A Moment Apart"]
    }
  ];

  function slugify(value) {
    return String(value || "review")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function normalizeReview(row) {
    return {
      id: row.id,
      title: row.title,
      album: row.album,
      artist: row.artist,
      genre: row.genre || "",
      year: row.year || "",
      score: row.score || "",
      author: row.author || "",
      published: row.published || "",
      coverUrl: row.coverUrl || row.cover_url || "",
      excerpt: row.excerpt || "",
      body: Array.isArray(row.body) ? row.body : [],
      tracks: Array.isArray(row.tracks) ? row.tracks : []
    };
  }

  function toSupabaseRow(review) {
    return {
      id: review.id,
      title: review.title,
      album: review.album,
      artist: review.artist,
      genre: review.genre,
      year: review.year,
      score: review.score,
      author: review.author,
      published: review.published,
      cover_url: review.coverUrl,
      excerpt: review.excerpt,
      body: review.body,
      tracks: review.tracks,
      status: "published"
    };
  }

  function getStoredReviews() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeReview) : [];
    } catch (error) {
      return [];
    }
  }

  function getLocalReviews() {
    const stored = getStoredReviews();
    const ids = new Set(stored.map((review) => review.id));
    return stored.concat(defaultReviews.filter((review) => !ids.has(review.id)));
  }

  async function getReviews() {
    if (!supabaseClient) return getLocalReviews();

    const { data, error } = await supabaseClient
      .from("reviews")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Supabase read failed, using local reviews.", error);
      return getLocalReviews();
    }

    const remote = (data || []).map(normalizeReview);
    const ids = new Set(remote.map((review) => review.id));
    return remote.concat(defaultReviews.filter((review) => !ids.has(review.id)));
  }

  async function saveReview(review) {
    if (supabaseClient) {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (!sessionData.session) throw new Error("Please sign in before publishing.");
      const { error } = await supabaseClient.from("reviews").upsert(toSupabaseRow(review));
      if (error) throw error;
      return review;
    }

    const stored = getStoredReviews().filter((item) => item.id !== review.id);
    localStorage.setItem(storageKey, JSON.stringify([review].concat(stored)));
    return review;
  }

  async function uploadCover(file, reviewId) {
    if (!file || !file.size) return "";

    if (!supabaseClient) {
      return readFileAsDataUrl(file);
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    if (!sessionData.session) throw new Error("Please sign in before uploading covers.");

    const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${reviewId}-${Date.now()}.${extension}`;
    const bucket = config.coverBucket || "album-covers";
    const { error } = await supabaseClient.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: true
    });
    if (error) throw error;

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  function getCurrentReview(reviews) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    return reviews.find((review) => review.id === id) || reviews[0];
  }

  function setText(selector, value, root) {
    (root || document).querySelectorAll(selector).forEach((node) => {
      node.textContent = value || "";
    });
  }

  function setHref(selector, href, label, root) {
    (root || document).querySelectorAll(selector).forEach((node) => {
      node.href = href;
      const textNode = Array.from(node.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
      if (textNode) {
        textNode.textContent = label;
      } else {
        node.append(document.createTextNode(label));
      }
    });
  }

  function renderCover(review) {
    const cover = document.querySelector("[data-review-cover]");
    const figure = document.querySelector(".album-cover");
    if (!cover || !figure) return;

    if (review.coverUrl) {
      cover.src = review.coverUrl;
      cover.alt = `${review.album} album cover`;
      figure.classList.add("has-cover-image");
    } else {
      cover.removeAttribute("src");
      cover.alt = "";
      figure.classList.remove("has-cover-image");
    }
  }

  function renderBody(review) {
    const body = document.querySelector("[data-review-body]");
    if (!body) return;

    body.innerHTML = "";
    review.body.forEach((paragraph, index) => {
      const node = document.createElement(index === 3 ? "blockquote" : "p");
      node.className = index === 0 ? "review-lead" : "";
      node.textContent = paragraph;
      body.append(node);
    });
  }

  function renderTracks(review) {
    const list = document.querySelector("[data-review-tracks]");
    if (!list) return;

    list.innerHTML = "";
    review.tracks.forEach((track, index) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      item.append(number, document.createTextNode(track));
      list.append(item);
    });
  }

  async function renderDetailPage() {
    if (!document.querySelector(".listening-review-page")) return;

    const reviews = await getReviews();
    const review = getCurrentReview(reviews);
    const index = reviews.findIndex((item) => item.id === review.id);
    const prev = reviews[(index - 1 + reviews.length) % reviews.length];
    const next = reviews[(index + 1) % reviews.length];

    document.title = `REVUE - ${review.title}`;
    setText("[data-review-title]", review.title);
    setText("[data-review-album]", review.album);
    setText("[data-review-artist]", review.artist);
    setText("[data-review-genre]", review.genre);
    setText("[data-review-year]", review.year);
    setText("[data-review-score]", review.score);
    setText("[data-review-author]", review.author);
    setText("[data-review-date]", review.published);
    setText("[data-review-cover-title]", `| ${review.album.toUpperCase()} |`);
    setText("[data-review-cover-artist]", review.artist.toUpperCase());
    renderCover(review);
    renderBody(review);
    renderTracks(review);
    setHref("[data-review-prev]", `index.html?id=${encodeURIComponent(prev.id)}`, prev.album);
    setHref("[data-review-next]", `index.html?id=${encodeURIComponent(next.id)}`, next.album);
  }

  async function renderListPage() {
    const list = document.querySelector("[data-review-list]");
    if (!list) return;

    const reviews = await getReviews();
    list.innerHTML = "";
    reviews.forEach((review) => {
      const item = document.createElement("a");
      item.className = "review-list-card";
      item.href = `index.html?id=${encodeURIComponent(review.id)}`;
      item.innerHTML = `
        <span>${review.score}</span>
        <strong>${review.title}</strong>
        <small>${review.artist} · ${review.album} · ${review.year}</small>
        <p>${review.excerpt || review.body[0] || ""}</p>
      `;
      list.append(item);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function splitLines(value) {
    return String(value || "")
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setBackendMode() {
    const node = document.querySelector("[data-backend-mode]");
    if (!node) return;
    node.textContent = supabaseClient
      ? "Backend: Supabase connected"
      : "Backend: Local browser storage fallback";
  }

  async function refreshAuthUI() {
    const authPanel = document.querySelector("[data-auth-panel]");
    const reviewForm = document.querySelector("[data-review-form]");
    const sessionLabel = document.querySelector("[data-session-label]");
    const signOutButton = document.querySelector("[data-sign-out]");
    if (!reviewForm) return;

    if (!supabaseClient) {
      if (authPanel) authPanel.hidden = true;
      reviewForm.hidden = false;
      if (sessionLabel) sessionLabel.textContent = "Local editor session";
      return;
    }

    const { data } = await supabaseClient.auth.getSession();
    const session = data.session;
    if (authPanel) authPanel.hidden = Boolean(session);
    reviewForm.hidden = !session;
    if (sessionLabel) sessionLabel.textContent = session ? `Signed in as ${session.user.email}` : "";
    if (signOutButton) signOutButton.hidden = !session;
  }

  function bindAuthForms() {
    const loginForm = document.querySelector("[data-login-form]");
    const signOutButton = document.querySelector("[data-sign-out]");
    if (!loginForm && !signOutButton) return;

    if (!supabaseClient) {
      refreshAuthUI();
      return;
    }

    const loginStatus = document.querySelector("[data-login-status]");
    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = loginForm.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      if (loginStatus) loginStatus.textContent = "Signing in...";

      try {
        const data = new FormData(loginForm);
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: String(data.get("email") || "").trim(),
          password: String(data.get("password") || "")
        });
        if (error) throw error;
        if (loginStatus) loginStatus.textContent = "";
        loginForm.reset();
        await refreshAuthUI();
      } catch (error) {
        if (loginStatus) loginStatus.textContent = `Sign in failed: ${error.message || error}`;
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });

    signOutButton?.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      await refreshAuthUI();
    });

    supabaseClient.auth.onAuthStateChange(() => {
      refreshAuthUI();
    });
    refreshAuthUI();
  }

  function bindAdminForm() {
    const form = document.querySelector("[data-review-form]");
    if (!form) return;

    const status = document.querySelector("[data-admin-status]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      if (status) status.textContent = "Saving...";

      try {
        const data = new FormData(form);
        const title = data.get("title");
        const album = data.get("album");
        const artist = data.get("artist");
        const id = slugify(`${artist}-${album}-${Date.now()}`);
        const coverFile = data.get("coverFile");
        let coverUrl = String(data.get("coverUrl") || "").trim();

        if (coverFile && coverFile.size) {
          coverUrl = await uploadCover(coverFile, id);
        }

        const review = {
          id,
          title: String(title || "").trim(),
          album: String(album || "").trim(),
          artist: String(artist || "").trim(),
          genre: String(data.get("genre") || "").trim(),
          year: String(data.get("year") || "").trim(),
          score: String(data.get("score") || "").trim(),
          author: String(data.get("author") || "").trim(),
          published: new Date().toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }),
          coverUrl,
          excerpt: String(data.get("excerpt") || "").trim(),
          body: splitLines(data.get("body")),
          tracks: splitLines(data.get("tracks"))
        };

        await saveReview(review);
        if (status) {
          status.innerHTML = `Saved. <a href="index.html?id=${encodeURIComponent(review.id)}">Open review</a>`;
        }
        form.reset();
        await renderListPage();
      } catch (error) {
        console.error(error);
        if (status) status.textContent = `Save failed: ${error.message || error}`;
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  window.RevueReviews = { getReviews, saveReview, hasSupabaseConfig };
  setBackendMode();
  bindAuthForms();
  renderDetailPage();
  renderListPage();
  bindAdminForm();
})();
