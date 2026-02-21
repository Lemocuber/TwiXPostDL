import crypto from "node:crypto";
import { HttpSession } from "./session.js";
import { ClientTransaction } from "./txid.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";

export class TwitterHttpError extends Error {
  constructor(status, reason, message) {
    super(`${status} ${reason} (${message})`);
    this.status = status;
    this.reason = reason;
    this.message = message;
  }
}

export class TwitterClient {
  constructor(cookiesPath) {
    this.root = "https://x.com/i/api";
    this.session = new HttpSession();
    this.session.headers["User-Agent"] = USER_AGENT;
    this._loadCookies(cookiesPath);
    this._ensureCookieDomain("auth_token");
    this._ensureCookieDomain("ct0");

    let csrf = this._cookie("ct0");
    const authToken = this._cookie("auth_token");
    if (!authToken) throw new Error("cookies must contain auth_token");
    if (!csrf) {
      csrf = crypto.randomBytes(16).toString("hex");
      this.session.setCookie("ct0", csrf, ".x.com", "/");
    }

    this.headers = {
      Accept: "*/*",
      Referer: "https://x.com/",
      "content-type": "application/json",
      "x-guest-token": null,
      "x-twitter-auth-type": "OAuth2Session",
      "x-csrf-token": csrf,
      "x-twitter-client-language": "en",
      "x-twitter-active-user": "yes",
      "x-client-transaction-id": null,
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      authorization:
        "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    };

    this.queryIds = {
      UserByScreenName: "ck5KkZ8t5cOmoLssopN99Q",
      UserTweets: "E8Wq-_jFSaU7hxVcuOPR9g",
    };
    this.qidRefreshTs = 0;

    this.featuresUser = {
      hidden_profile_subscriptions_enabled: true,
      payments_enabled: false,
      rweb_xchat_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    };

    this.featuresPage = {
      rweb_video_screen_enabled: false,
      payments_enabled: false,
      rweb_xchat_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_jetfuel_frame: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    };

    this.restParams = {
      include_profile_interstitial_type: "1",
      include_blocking: "1",
      include_blocked_by: "1",
      include_followed_by: "1",
      include_want_retweets: "1",
      include_mute_edge: "1",
      include_can_dm: "1",
      include_can_media_tag: "1",
      include_ext_is_blue_verified: "1",
      include_ext_verified_type: "1",
      include_ext_profile_image_shape: "1",
      skip_status: "1",
      cards_platform: "Web-12",
      include_cards: "1",
      include_ext_alt_text: "true",
      include_ext_limited_action_results: "true",
      include_quote_count: "true",
      include_reply_count: "1",
      tweet_mode: "extended",
      include_ext_views: "true",
      include_entities: "true",
      include_user_entities: "true",
      include_ext_media_color: "true",
      include_ext_media_availability: "true",
      include_ext_sensitive_media_warning: "true",
      include_ext_trusted_friends_metadata: "true",
      send_error_codes: "true",
      simple_quoted_tweet: "true",
      count: "20",
      ext: "mediaStats,highlightedLabel,parodyCommentaryFanLabel,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article",
    };

    this.txid = new ClientTransaction();
  }

  async initialize() {
    await this.txid.initialize(this.session);
  }

  _loadCookies(cookiesPath) {
    this.session.loadMozillaCookies(cookiesPath);
  }

  _cookie(name) {
    return this.session.getCookie(name, ["x.com", "twitter.com"]);
  }

  _ensureCookieDomain(name, domain = ".x.com") {
    if (this.session.getCookie(name, [domain])) return;
    const val = this._cookie(name);
    if (val) this.session.setCookie(name, val, domain, "/");
  }

  _dumps(data) {
    return JSON.stringify(data);
  }

  _setTransactionId(url, method = "GET") {
    const pos = url.indexOf("/", 8);
    const reqPath = pos >= 0 ? url.slice(pos) : "/";
    this.headers["x-client-transaction-id"] = this.txid.generateTransactionId(method, reqPath);
  }

  async _call(endpoint, params) {
    const url = `${this.root}${endpoint}`;
    this._setTransactionId(url, "GET");

    for (;;) {
      const resp = await this.session.get(url, { params, headers: this.headers, timeoutMs: 30_000 });
      const csrf = this._cookie("ct0");
      if (csrf) this.headers["x-csrf-token"] = csrf;

      if (resp.status === 429) {
        await this._handleRatelimit(resp);
        continue;
      }

      let data;
      try {
        data = await resp.json();
      } catch {
        data = { errors: [{ message: await resp.text() }] };
      }

      const errors = data.errors || [];
      if (resp.status >= 400) {
        const msg = errors.map((e) => e.message || e.code || "Unspecified").join(", ") || "Unspecified";
        throw new TwitterHttpError(resp.status, resp.statusText, msg);
      }

      if (errors.length) {
        const msg = errors.map((e) => e.message || e.code || "Unspecified").join(", ");
        throw new TwitterHttpError(400, "API Error", msg);
      }

      return data;
    }
  }

  async _handleRatelimit(response) {
    const until = response.headers.get("x-rate-limit-reset");
    let wait = 60;
    if (until) {
      const sec = Number.parseInt(until, 10) - Math.floor(Date.now() / 1000);
      wait = Number.isFinite(sec) ? Math.max(sec, 1) : 60;
    }
    await sleep(wait * 1000);
  }

  async _graphql(operation, params) {
    let qid = this.queryIds[operation];
    if (!qid) {
      await this._refreshQueryIds(new Set([operation]), true);
      qid = this.queryIds[operation];
    }
    if (!qid) throw new Error(`missing GraphQL query id for ${operation}`);

    let endpoint = `/graphql/${qid}/${operation}`;
    try {
      return await this._call(endpoint, params);
    } catch (err) {
      if (!(err instanceof TwitterHttpError) || err.status !== 404) throw err;
    }

    await this._refreshQueryIds(new Set([operation]), true);
    qid = this.queryIds[operation];
    if (!qid) throw new Error(`unable to refresh query id for ${operation}`);
    endpoint = `/graphql/${qid}/${operation}`;
    return this._call(endpoint, params);
  }

  async _refreshQueryIds(needed, force = false) {
    if (!force && Date.now() / 1000 - this.qidRefreshTs < 300) return;
    this.qidRefreshTs = Date.now() / 1000;
    const need = new Set(needed);

    let homepage;
    try {
      homepage = await (await this.session.get("https://x.com/", { timeoutMs: 30_000 })).text();
    } catch {
      return;
    }

    const urls = this._scriptUrls(homepage);
    const prior = urls.filter((u) => u.includes("/main.") || u.includes("main."));
    for (const url of [...prior, ...urls.filter((u) => !prior.includes(u))]) {
      if (!need.size) break;
      let js;
      try {
        js = await (await this.session.get(url, { timeoutMs: 30_000 })).text();
      } catch {
        continue;
      }
      for (const [qid, op] of this._extractQueryIds(js)) {
        if (need.has(op)) {
          this.queryIds[op] = qid;
          need.delete(op);
        }
      }
    }
  }

  _scriptUrls(homepage) {
    const urls = [];
    const seen = new Set();
    for (const m of homepage.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      let src = m[1];
      if (!src.endsWith(".js")) continue;
      if (src.startsWith("//")) src = `https:${src}`;
      else if (src.startsWith("/")) src = `https://x.com${src}`;
      else if (!src.startsWith("http")) src = `https://x.com/${src.replace(/^\/+/, "")}`;
      if (seen.has(src)) continue;
      seen.add(src);
      urls.push(src);
    }
    return urls;
  }

  _extractQueryIds(js) {
    const out = [];
    const pats = [
      /\/i\/api\/graphql\/([A-Za-z0-9_-]{20,})\/([A-Za-z0-9_]+)/g,
      /\\\/i\\\/api\\\/graphql\\\/([A-Za-z0-9_-]{20,})\\\/([A-Za-z0-9_]+)/g,
      /graphql\/([A-Za-z0-9_-]{20,})\/([A-Za-z0-9_]+)/g,
      /queryId:"([A-Za-z0-9_-]{20,})",operationName:"([A-Za-z0-9_]+)"/g,
      /"queryId":"([A-Za-z0-9_-]{20,})","operationName":"([A-Za-z0-9_]+)"/g,
    ];
    for (const pat of pats) {
      for (const m of js.matchAll(pat)) out.push([m[1], m[2]]);
    }
    return out;
  }

  async userByScreenName(screenName) {
    const features = { ...this.featuresUser };
    features.subscriptions_verification_info_is_identity_verified_enabled = true;
    features.subscriptions_verification_info_verified_since_enabled = true;
    const params = {
      variables: this._dumps({ screen_name: screenName, withGrokTranslatedBio: false }),
      features: this._dumps(features),
      fieldToggles: this._dumps({ withAuxiliaryUserLabels: true }),
    };
    const user = (await this._graphql("UserByScreenName", params)).data.user.result;
    if (user.__typename === "UserUnavailable") throw new Error(user.message || `user unavailable: ${screenName}`);
    return user;
  }

  async _userIdByScreenName(screenName) {
    const user = await this.userByScreenName(screenName);
    if (!Object.prototype.hasOwnProperty.call(user, "rest_id")) {
      throw new Error(`could not resolve user id for ${screenName}`);
    }
    return user.rest_id;
  }

  async *iterUserTweets(screenName, limit) {
    try {
      yield* this._iterUserTweetsGraphql(screenName, limit);
      return;
    } catch {
      yield* this._iterUserTweetsSearch(screenName, limit);
    }
  }

  async *_iterUserTweetsGraphql(screenName, limit) {
    const variables = {
      userId: await this._userIdByScreenName(screenName),
      count: Math.min(Math.max(Number.parseInt(limit, 10), 1), 50),
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: false,
      withVoice: true,
    };

    const params = {
      variables: null,
      features: this._dumps(this.featuresPage),
      fieldToggles: this._dumps({ withArticlePlainText: false }),
    };

    let yielded = 0;
    while (yielded < limit) {
      params.variables = this._dumps(variables);
      const data = await this._graphql("UserTweets", params);
      const instructions = this._timelineInstructions(data);
      let [entries, cursor] = this._timelineEntries(instructions);
      if (entries === null) return;
      const [tweetEntries, cursor2] = this._collectTweetEntries(entries);
      cursor = cursor2 || cursor;

      let seenPage = false;
      for (const entry of tweetEntries) {
        const tweet = this._entryToTweet(entry);
        if (!tweet) continue;
        seenPage = true;
        yielded += 1;
        yield tweet;
        if (yielded >= limit) return;
      }

      if (!cursor || cursor === variables.cursor || !seenPage) return;
      variables.cursor = cursor;
    }
  }

  async *_iterUserTweetsSearch(screenName, limit) {
    let cursor = null;
    let yielded = 0;
    while (yielded < limit) {
      const count = Math.min(20, Math.max(1, limit - yielded));
      const [tweets, next] = await this.userTweetsSearchPage(screenName, count, cursor, true);
      cursor = next;
      if (!tweets.length) return;
      for (const tweet of tweets) {
        yielded += 1;
        yield tweet;
        if (yielded >= limit) return;
      }
      if (!cursor) return;
    }
  }

  async userTweetsSearchPage(screenName, count, cursor = null, includeRetweets = true) {
    const params = { ...this.restParams };
    let query = `from:${screenName}`;
    if (includeRetweets) query += " include:retweets include:nativeretweets";
    params.q = query;
    params.query_source = "typed_query";
    params.pc = "1";
    params.spelling_corrections = "1";
    params.tweet_search_mode = "live";
    params.count = String(count);
    if (cursor) params.cursor = cursor;

    const data = await this._call("/2/search/adaptive.json", params);
    const instructions = (data.timeline || {}).instructions || [];
    const tweets = (data.globalObjects || {}).tweets || {};
    const users = (data.globalObjects || {}).users || {};
    let entries = [];
    let nextCursor = null;

    for (const instr of instructions) {
      if (instr.addEntries) entries = instr.addEntries.entries || [];
      else if (instr.replaceEntry) {
        const entry = instr.replaceEntry.entry || {};
        const id = entry.entryId || "";
        if (id.startsWith("cursor-bottom-") || id.startsWith("sq-cursor-bottom")) {
          const op = (entry.content || {}).operation || {};
          const cur = op.cursor || {};
          nextCursor = cur.value;
        }
      }
    }

    const out = [];
    for (const entry of entries) {
      const eid = entry.entryId || "";
      if (eid.startsWith("cursor-bottom-") || eid.startsWith("sq-cursor-bottom")) {
        const op = (entry.content || {}).operation || {};
        const cur = op.cursor || {};
        nextCursor = cur.value || nextCursor;
        continue;
      }

      if (eid.startsWith("tweet-") || eid.startsWith("sq-I-t-")) {
        const twid = (((entry.content || {}).item || {}).content || {}).tweet?.id;
        const tweet = tweets[String(twid)];
        if (!tweet) continue;
        const user = users[tweet.user_id_str];
        if (user) tweet.user = user;
        out.push(tweet);
        continue;
      }

      if (eid.startsWith("homeConversation-")) {
        const ids = ((((entry.content || {}).timelineModule || {}).metadata || {}).conversationMetadata || {}).allTweetIds || [];
        for (const twid of [...ids].reverse()) {
          const tweet = tweets[String(twid)];
          if (!tweet) continue;
          const user = users[tweet.user_id_str];
          if (user) tweet.user = user;
          out.push(tweet);
        }
      }
    }

    return [out, nextCursor];
  }

  _timelineInstructions(data) {
    try {
      return data.data.user.result.timeline.timeline.instructions;
    } catch {
      throw new Error("unable to parse user timeline response");
    }
  }

  _timelineEntries(instructions) {
    let cursor = null;
    let entries = null;
    for (const instr of instructions) {
      const typ = instr.type;
      if (typ === "TimelineAddEntries") {
        if (entries && entries.length) entries.push(...instr.entries);
        else entries = [...instr.entries];
      } else if (typ === "TimelineAddToModule") {
        entries = [...instr.moduleItems];
      } else if (typ === "TimelineReplaceEntry") {
        const entry = instr.entry;
        if ((entry.entryId || "").startsWith("cursor-bottom-")) cursor = entry.content.value;
      }
    }
    return [entries, cursor];
  }

  _collectTweetEntries(entries) {
    if (entries === null) return [[], null];
    const tweets = [];
    let cursor = null;
    for (const entry of entries) {
      const eid = entry.entryId || "";
      if (eid.startsWith("tweet-")) tweets.push(entry);
      else if (eid.startsWith("profile-grid-") || eid.startsWith("search-grid-") || eid.startsWith("communities-grid-")) {
        if (entry.content) tweets.push(...(entry.content.items || []));
        else tweets.push(entry);
      } else if (
        eid.startsWith("homeConversation-") ||
        eid.startsWith("profile-conversation-") ||
        eid.startsWith("conversationthread-")
      ) {
        tweets.push(...((entry.content || {}).items || []));
      } else if (eid.startsWith("cursor-bottom-")) {
        let c = entry.content || {};
        if (c.itemContent) c = c.itemContent;
        cursor = c.value;
      }
    }
    return [tweets, cursor];
  }

  _entryToTweet(entry) {
    let item;
    let tweet;
    let legacy;
    try {
      item = (entry.content || entry.item).itemContent;
      if (item.promotedMetadata) return null;
      tweet = item.tweet_results.result;
      if (tweet.tweet) tweet = tweet.tweet;
      legacy = tweet.legacy;
      tweet.sortIndex = entry.sortIndex;
    } catch {
      return null;
    }

    if (legacy.retweeted_status_result) {
      try {
        let retweet = legacy.retweeted_status_result.result;
        if (retweet.tweet) retweet = retweet.tweet;
        legacy.retweeted_status_id_str = retweet.rest_id;
        tweet.author = retweet.core.user_results.result;
        const rtlegacy = retweet.legacy;
        if (retweet.note_tweet) tweet.note_tweet = retweet.note_tweet;
        if (rtlegacy.extended_entities && !legacy.extended_entities) legacy.extended_entities = rtlegacy.extended_entities;
        if (rtlegacy.withheld_scope && !legacy.withheld_scope) legacy.withheld_scope = rtlegacy.withheld_scope;
        if (rtlegacy.full_text) legacy.full_text = rtlegacy.full_text;
      } catch {
        return null;
      }
    }

    return tweet;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
