(function () {
  const storageKey = "yueping.reviews.v2";
  const config = window.REVUE_CONFIG || {};
  const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  const supabaseClient = hasSupabaseConfig
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

  const defaultReviews = [
    {
      id: "sample-rain-listening",
      title: "雨夜里重新听见低频",
      album: "虚构的月光",
      artist: "月评编辑部",
      genre: "Ambient Pop / 中文独立",
      year: "2026",
      score: "8.4",
      author: "编辑部",
      published: "2026年6月18日",
      coverUrl: "",
      excerpt: "这是一篇用于空状态的示例乐评。真正的月评，会从第一位投稿者按下提交开始。",
      body: [
        "这是一篇用于空状态的示例乐评。它提醒我们，音乐评论最重要的不是把专辑归类，而是把一次具体的聆听经验写清楚。",
        "一张唱片可以从很多地方进入：鼓声的距离、人声的位置、歌词里的气温，或者某个突然安静下来的瞬间。",
        "当你提交第一篇真实乐评后，这里会优先展示已经通过审核的内容。"
      ],
      tracks: ["开场白", "低频", "雨后"]
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

  function todayZh() {
    return new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
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
      author: row.author || row.submitter_email || "",
      published: row.published || "",
      coverUrl: row.coverUrl || row.cover_url || "",
      excerpt: row.excerpt || "",
      body: Array.isArray(row.body) ? row.body : [],
      tracks: Array.isArray(row.tracks) ? row.tracks : [],
      status: row.status || "published",
      reviewNote: row.review_note || "",
      submitterEmail: row.submitter_email || "",
      userId: row.user_id || ""
    };
  }

  function toPendingRow(review, session) {
    return {
      id: review.id,
      title: review.title,
      album: review.album,
      artist: review.artist,
      genre: review.genre,
      year: review.year,
      score: review.score,
      author: review.author,
      published: "",
      cover_url: review.coverUrl,
      excerpt: review.excerpt,
      body: review.body,
      tracks: review.tracks,
      status: "pending",
      review_note: "",
      user_id: session.user.id,
      submitter_email: session.user.email
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
    const stored = getStoredReviews().filter((review) => review.status === "published");
    const ids = new Set(stored.map((review) => review.id));
    return stored.concat(defaultReviews.filter((review) => !ids.has(review.id)));
  }

  async function getSession() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return data.session || null;
  }

  function isEmailVerified(session) {
    return Boolean(session?.user?.email_confirmed_at || session?.user?.confirmed_at);
  }

  async function isAdmin() {
    if (!supabaseClient) return true;
    const session = await getSession();
    if (!session) return false;
    const { data, error } = await supabaseClient
      .from("admin_users")
      .select("email")
      .eq("email", session.user.email)
      .maybeSingle();
    return !error && Boolean(data);
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

  async function getPendingReviews() {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient
      .from("reviews")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(normalizeReview);
  }

  async function getMyReviews() {
    if (!supabaseClient) return [];
    const session = await getSession();
    if (!session) return [];
    const { data, error } = await supabaseClient
      .from("reviews")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeReview);
  }

  async function submitReview(review) {
    if (supabaseClient) {
      const session = await getSession();
      if (!session) throw new Error("请先登录后再投稿。");
      if (!isEmailVerified(session)) throw new Error("请先完成邮箱验证，再提交乐评。");
      const { error } = await supabaseClient.from("reviews").insert(toPendingRow(review, session));
      if (error) throw error;
      return review;
    }

    const stored = getStoredReviews().filter((item) => item.id !== review.id);
    localStorage.setItem(storageKey, JSON.stringify([{ ...review, status: "published" }].concat(stored)));
    return review;
  }

  async function moderateReview(id, status, note) {
    if (!supabaseClient) throw new Error("当前没有连接 Supabase。");
    const patch = {
      status,
      review_note: note || "",
      published: status === "published" ? todayZh() : ""
    };
    const { error } = await supabaseClient.from("reviews").update(patch).eq("id", id);
    if (error) throw error;
  }

  async function uploadCover(file, reviewId) {
    if (!file || !file.size) return "";

    if (!supabaseClient) {
      return readFileAsDataUrl(file);
    }

    const session = await getSession();
    if (!session) throw new Error("请先登录后再上传封面。");
    if (!isEmailVerified(session)) throw new Error("请先完成邮箱验证，再上传封面。");

    const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${session.user.id}/${reviewId}-${Date.now()}.${extension}`;
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
      cover.alt = `${review.album} 专辑封面`;
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
    const tracks = review.tracks.length ? review.tracks : ["暂无推荐曲目"];
    tracks.forEach((track, index) => {
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

    document.title = `月评 - ${review.title}`;
    setText("[data-review-title]", review.title);
    setText("[data-review-album]", review.album);
    setText("[data-review-artist]", review.artist);
    setText("[data-review-genre]", review.genre || "未分类");
    setText("[data-review-year]", review.year || "--");
    setText("[data-review-score]", review.score || "--");
    setText("[data-review-author]", review.author || "匿名作者");
    setText("[data-review-date]", review.published || "待发布");
    setText("[data-review-cover-title]", `| ${review.album} |`);
    setText("[data-review-cover-artist]", review.artist);
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
        <span>${review.score || "--"}</span>
        <strong>${escapeHtml(review.title)}</strong>
        <small>${escapeHtml(review.artist)} / ${escapeHtml(review.album)} / ${escapeHtml(review.year)}</small>
        <p>${escapeHtml(review.excerpt || review.body[0] || "")}</p>
      `;
      list.append(item);
    });
  }

  async function renderAlbumIndex() {
    const list = document.querySelector("[data-album-index]");
    if (!list) return;

    const reviews = await getReviews();
    list.innerHTML = "";
    reviews.forEach((review) => {
      const item = document.createElement("a");
      item.className = "album-index-card";
      item.href = `../index.html?id=${encodeURIComponent(review.id)}`;
      item.innerHTML = `
        <div>${review.coverUrl ? `<img src="${escapeAttribute(review.coverUrl)}" alt="${escapeAttribute(review.album)} 专辑封面" />` : "<span>月评</span>"}</div>
        <strong>${escapeHtml(review.album)}</strong>
        <small>${escapeHtml(review.artist)} / ${escapeHtml(review.year || "未知年份")}</small>
        <p>${escapeHtml(review.genre || "未分类")} · ${escapeHtml(review.score || "--")} / 10</p>
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

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function setBackendMode() {
    const node = document.querySelector("[data-backend-mode]");
    if (!node) return;
    node.textContent = supabaseClient ? "后端：Supabase 已连接" : "后端：本地浏览器存储模式";
  }

  async function refreshAuthUI() {
    const authPanel = document.querySelector("[data-auth-panel]");
    const reviewForm = document.querySelector("[data-review-form]");
    const adminPanel = document.querySelector("[data-admin-panel]");
    const userSubmissions = document.querySelector("[data-user-submissions]");
    const sessionLabel = document.querySelector("[data-session-label]");
    const signOutButton = document.querySelector("[data-sign-out]");
    const loginStatus = document.querySelector("[data-login-status]");
    const isSubmitPage = Boolean(document.querySelector(".review-submit-page"));
    const isAdminPage = Boolean(document.querySelector(".review-admin-page"));

    if (!authPanel && !reviewForm && !adminPanel) return;

    if (!supabaseClient) {
      if (authPanel) authPanel.hidden = true;
      if (reviewForm) reviewForm.hidden = false;
      if (adminPanel) adminPanel.hidden = false;
      if (userSubmissions) userSubmissions.hidden = true;
      if (sessionLabel) sessionLabel.textContent = "本地编辑模式";
      return;
    }

    const session = await getSession();
    const verified = isEmailVerified(session);
    const admin = session ? await isAdmin() : false;

    if (authPanel) authPanel.hidden = Boolean(session);
    if (signOutButton) signOutButton.hidden = !session;
    if (sessionLabel && session) {
      sessionLabel.textContent = `${session.user.email}${admin ? " / 管理员" : ""}`;
    }

    if (reviewForm) {
      reviewForm.hidden = !(session && verified && isSubmitPage);
    }

    if (userSubmissions) {
      userSubmissions.hidden = !(session && isSubmitPage);
      if (!userSubmissions.hidden) await renderUserSubmissions();
    }

    if (adminPanel) {
      adminPanel.hidden = !(session && admin && isAdminPage);
      if (session && !admin && loginStatus) loginStatus.textContent = "当前账号不是管理员，无法进入审核后台。";
    }

    if (session && !verified && loginStatus) {
      loginStatus.textContent = "请先打开邮箱完成验证，然后刷新本页。";
    }

    if (adminPanel && !adminPanel.hidden) {
      await renderModerationList();
    }
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
      const submitter = event.submitter;
      const intent = submitter?.value || "signin";
      const buttons = loginForm.querySelectorAll("button[type='submit']");
      buttons.forEach((button) => (button.disabled = true));
      if (loginStatus) loginStatus.textContent = intent === "signup" ? "正在注册..." : "正在登录...";

      try {
        const data = new FormData(loginForm);
        const email = String(data.get("email") || "").trim();
        const password = String(data.get("password") || "");

        if (intent === "signup") {
          const { error } = await supabaseClient.auth.signUp({ email, password });
          if (error) throw error;
          if (loginStatus) loginStatus.textContent = "注册成功。请先查收验证邮件，再回到这里登录投稿。";
        } else {
          const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (loginStatus) loginStatus.textContent = "";
          loginForm.reset();
          await refreshAuthUI();
        }
      } catch (error) {
        if (loginStatus) loginStatus.textContent = `操作失败：${error.message || error}`;
      } finally {
        buttons.forEach((button) => (button.disabled = false));
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

  function bindSubmitForm() {
    const form = document.querySelector("[data-review-form]");
    if (!form) return;

    const status = document.querySelector("[data-admin-status]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      if (status) status.textContent = "正在提交审核...";

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
          author: String(data.get("author") || "").trim() || "匿名作者",
          published: "",
          coverUrl,
          excerpt: String(data.get("excerpt") || "").trim(),
          body: splitLines(data.get("body")),
          tracks: splitLines(data.get("tracks")),
          status: "pending"
        };

        await submitReview(review);
        if (status) status.textContent = "已提交审核。编辑部发布后会出现在前台。";
        form.reset();
        document.querySelector("[data-album-results]")?.replaceChildren();
        await renderUserSubmissions();
      } catch (error) {
        console.error(error);
        if (status) status.textContent = `提交失败：${error.message || error}`;
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  async function renderModerationList() {
    const list = document.querySelector("[data-moderation-list]");
    const status = document.querySelector("[data-admin-status]");
    if (!list) return;

    try {
      const reviews = await getPendingReviews();
      if (status) status.textContent = reviews.length ? `共有 ${reviews.length} 篇待审核。` : "暂无待审核投稿。";
      list.innerHTML = "";
      reviews.forEach((review) => {
        const item = document.createElement("article");
        item.className = "moderation-card";
        item.dataset.reviewId = review.id;
        item.innerHTML = `
          <div>
            <span>${escapeHtml(review.submitterEmail || "未知投稿人")}</span>
            <h3>${escapeHtml(review.title)}</h3>
            <p>${escapeHtml(review.artist)} / ${escapeHtml(review.album)} / ${escapeHtml(review.year)}</p>
            <p>${escapeHtml(review.excerpt || review.body[0] || "")}</p>
          </div>
          <textarea placeholder="退回原因或编辑备注" rows="3"></textarea>
          <div class="admin-actions">
            <button type="button" data-publish>发布</button>
            <button type="button" data-reject>退回</button>
          </div>
        `;
        list.append(item);
      });
    } catch (error) {
      if (status) status.textContent = `加载失败：${error.message || error}`;
    }
  }

  async function renderUserSubmissions() {
    const list = document.querySelector("[data-user-submissions-list]");
    const status = document.querySelector("[data-user-submissions-status]");
    if (!list) return;

    try {
      const reviews = await getMyReviews();
      if (status) status.textContent = reviews.length ? `共有 ${reviews.length} 篇投稿。` : "你还没有提交过乐评。";
      list.innerHTML = "";
      reviews.forEach((review) => {
        const item = document.createElement("article");
        item.className = "moderation-card submission-card";
        const statusText = {
          pending: "待审核",
          published: "已发布",
          rejected: "已退回"
        }[review.status] || review.status;
        item.innerHTML = `
          <div>
            <span>${escapeHtml(statusText)}</span>
            <h3>${escapeHtml(review.title)}</h3>
            <p>${escapeHtml(review.artist)} / ${escapeHtml(review.album)} / ${escapeHtml(review.year)}</p>
            ${review.reviewNote ? `<p>编辑备注：${escapeHtml(review.reviewNote)}</p>` : ""}
            ${review.status === "published" ? `<p><a href="index.html?id=${encodeURIComponent(review.id)}">打开已发布乐评</a></p>` : ""}
          </div>
        `;
        list.append(item);
      });
    } catch (error) {
      if (status) status.textContent = `加载失败：${error.message || error}`;
    }
  }

  function bindModerationActions() {
    const list = document.querySelector("[data-moderation-list]");
    if (!list) return;

    list.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const card = event.target.closest("[data-review-id]");
      if (!card) return;
      const status = document.querySelector("[data-admin-status]");
      const note = card.querySelector("textarea")?.value || "";
      const nextStatus = button.matches("[data-publish]") ? "published" : "rejected";

      button.disabled = true;
      if (status) status.textContent = nextStatus === "published" ? "正在发布..." : "正在退回...";
      try {
        await moderateReview(card.dataset.reviewId, nextStatus, note);
        await renderModerationList();
      } catch (error) {
        if (status) status.textContent = `操作失败：${error.message || error}`;
      } finally {
        button.disabled = false;
      }
    });
  }

  function bindAlbumSearch() {
    const button = document.querySelector("[data-album-search]");
    const resultsNode = document.querySelector("[data-album-results]");
    const statusNode = document.querySelector("[data-album-search-status]");
    const form = document.querySelector("[data-review-form]");
    if (!button || !resultsNode || !form) return;

    button.addEventListener("click", async () => {
      const album = form.elements.searchAlbum?.value || form.elements.album?.value || "";
      const artist = form.elements.searchArtist?.value || form.elements.artist?.value || "";
      if (!album && !artist) {
        if (statusNode) statusNode.textContent = "请至少输入专辑名或艺人名。";
        return;
      }

      button.disabled = true;
      resultsNode.innerHTML = "";
      if (statusNode) statusNode.textContent = "正在搜索专辑数据库...";
      try {
        const url = new URL("/.netlify/functions/album-search", window.location.origin);
        url.searchParams.set("album", album);
        url.searchParams.set("artist", artist);
        const response = await fetch(url);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "搜索失败");
        const results = payload.results || [];
        if (statusNode) statusNode.textContent = results.length ? `找到 ${results.length} 个结果。` : "没有找到结果，请手动填写。";
        renderAlbumResults(results, form, resultsNode);
      } catch (error) {
        if (statusNode) statusNode.textContent = `搜索失败：${error.message || error}。你仍然可以手动填写。`;
      } finally {
        button.disabled = false;
      }
    });
  }

  function renderAlbumResults(results, form, resultsNode) {
    resultsNode.innerHTML = "";
    results.forEach((result) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "album-result-card";
      item.innerHTML = `
        ${result.coverUrl ? `<img src="${escapeAttribute(result.coverUrl)}" alt="${escapeAttribute(result.album)} 封面" />` : "<span>无封面</span>"}
        <strong>${escapeHtml(result.album)}</strong>
        <small>${escapeHtml(result.artist)} / ${escapeHtml(result.year || "未知年份")}</small>
      `;
      item.addEventListener("click", () => {
        form.elements.album.value = result.album || "";
        form.elements.artist.value = result.artist || "";
        form.elements.year.value = result.year || "";
        form.elements.coverUrl.value = result.coverUrl || "";
        if (result.tracks?.length) form.elements.tracks.value = result.tracks.join("\n");
      });
      resultsNode.append(item);
    });
  }

  window.RevueReviews = { getReviews, submitReview, hasSupabaseConfig };
  setBackendMode();
  bindAuthForms();
  bindSubmitForm();
  bindModerationActions();
  bindAlbumSearch();
  renderDetailPage();
  renderListPage();
  renderAlbumIndex();
})();
