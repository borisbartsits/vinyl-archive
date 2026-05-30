import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";

const API    = "https://api.anthropic.com/v1/messages";
const SB_URL = "https://xbjdeltxdqrwgemtycii.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiamRlbHR4ZHFyd2dlbXR5Y2lpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzgyNDgsImV4cCI6MjA5NTMxNDI0OH0.n2KrFakhS1F3zAjUUdPU4gqCKxqZurMIsYbVmNw6cuE";
// ── Supabase helpers ───────────────────────────────────────────────────────
let _token = SB_KEY; // replaced with user JWT after login
let _userId = null;

function sbHeaders() {
  return {
    "apikey": SB_KEY,
    "Authorization": "Bearer " + _token,
    "Content-Type": "application/json",
  };
}

async function authSignUp(email, password) {
  const r = await fetch(SB_URL + "/auth/v1/signup", {
    method: "POST",
    headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.msg || "Ошибка регистрации");
  return d;
}

async function authSignIn(email, password) {
  const r = await fetch(SB_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.msg || "Неверный email или пароль");
  _token  = d.access_token;
  _userId = d.user?.id;
  return d;
}

async function authSignOut() {
  await fetch(SB_URL + "/auth/v1/logout", {
    method: "POST", headers: sbHeaders(),
  }).catch(() => {});
  _token = SB_KEY; _userId = null;
}

async function dbGetAll() {
  const r = await fetch(SB_URL + "/rest/v1/albums?select=*&order=artist.asc", { headers: sbHeaders() });
  if (!r.ok) throw new Error("DB read: " + r.status);
  const rows = await r.json();
  return rows.map(row => ({
    id: row.id, artist: row.artist, album: row.album, year: row.year,
    genre: row.genre, label: row.label, country: row.country,
    condition: row.condition, tracks: row.tracks || [], price: row.price,
    notes: row.notes, thumb: row.thumb, thumbFront: row.thumb_front,
    thumbBack: row.thumb_back, at: row.at,
  }));
}

async function dbSave(rec) {
  const row = {
    id: rec.id, artist: rec.artist, album: rec.album, year: rec.year,
    genre: rec.genre, label: rec.label, country: rec.country,
    condition: rec.condition || null, tracks: rec.tracks || [],
    price: rec.price || null, notes: rec.notes || null,
    thumb: rec.thumb || null, thumb_front: rec.thumbFront || rec.thumb || null,
    thumb_back: rec.thumbBack || null, at: rec.at || new Date().toISOString(),
    user_id: _userId,
  };
  const r = await fetch(SB_URL + "/rest/v1/albums", {
    method: "POST",
    headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error("DB save: " + r.status);
}

async function dbDelete(id) {
  const r = await fetch(SB_URL + "/rest/v1/albums?id=eq." + encodeURIComponent(id), {
    method: "DELETE", headers: sbHeaders(),
  });
  if (!r.ok) throw new Error("DB delete: " + r.status);
}


async function sbFetch(url, opts = {}) {
  let r = await fetch(url, { ...opts, headers: { ...sbHeaders(), ...(opts.headers || {}) } });
  if (r.status === 401) {
    // Try refresh
    try {
      const s = await window.storage.get("session");
      if (s?.value) {
        const sess = JSON.parse(s.value);
        if (sess.refreshToken) {
          const rr = await fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: sess.refreshToken }),
          });
          if (rr.ok) {
            const rd = await rr.json();
            _token = rd.access_token;
            _userId = rd.user?.id;
            await window.storage.set("session", JSON.stringify({ ...sess, token: rd.access_token, refreshToken: rd.refresh_token, userId: rd.user?.id }));
            // Retry original request
            r = await fetch(url, { ...opts, headers: { ...sbHeaders(), ...(opts.headers || {}) } });
          }
        }
      }
    } catch {}
  }
  return r;
}

// ── Profile functions ─────────────────────────────────────────────────────

async function dbGetProfile(userId) {
  const r = await sbFetch(SB_URL + "/rest/v1/profiles?select=*&id=eq." + (userId || _userId));
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function dbSaveProfile(data) {
  const r = await sbFetch(SB_URL + "/rest/v1/profiles?id=eq." + _userId, {
    method: "PATCH",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error("Profile save failed: " + r.status);
  const rows = await r.json();
  return rows[0];
}


async function dbSetAllPublic(isPublic) {
  const r = await sbFetch(SB_URL + "/rest/v1/albums?user_id=eq." + _userId, {
    method: "PATCH",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify({ is_public: isPublic }),
  });
  if (!r.ok) throw new Error("Ошибка: " + r.status);
}

async function dbGetPublicProfile(username) {
  const r = await fetch(SB_URL + "/rest/v1/profiles?select=*&username=eq." + encodeURIComponent(username),
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY } });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function dbGetPublicAlbums(userId) {
  const r = await fetch(SB_URL + "/rest/v1/albums?select=*&user_id=eq." + userId + "&is_public=eq.true",
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY } });
  if (!r.ok) return [];
  return await r.json();
}

async function dbGetAllPublicAlbums(userId) {
  // Get all user albums if profile is public (admin read via anon)
  const r = await fetch(SB_URL + "/rest/v1/albums?select=*&user_id=eq." + userId,
    { headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY } });
  if (!r.ok) return [];
  return await r.json();
}


async function dbGetBalance() {
  const r = await sbFetch(SB_URL + "/rest/v1/balances?select=*&user_id=eq." + _userId);
  if (!r.ok) return null;
  const d = await r.json();
  return d[0] || null;
}

async function dbGetTransactions() {
  const r = await fetch(SB_URL + "/rest/v1/transactions?select=*&user_id=eq." + _userId + "&order=created_at.desc&limit=20", { headers: sbHeaders() });
  if (!r.ok) return [];
  return await r.json();
}

async function dbDeductBalance(amount, description, type) {
  const bal = await dbGetBalance();
  if (!bal) return false;
  if (bal.balance < amount) return false;
  await fetch(SB_URL + "/rest/v1/balances?user_id=eq." + _userId, {
    method: "PATCH",
    headers: { ...sbHeaders(), "Prefer": "return=minimal" },
    body: JSON.stringify({ balance: bal.balance - amount, updated_at: new Date().toISOString() }),
  });
  await fetch(SB_URL + "/rest/v1/transactions", {
    method: "POST",
    headers: { ...sbHeaders(), "Prefer": "return=minimal" },
    body: JSON.stringify({ user_id: _userId, type, amount: -amount, description, status: "completed" }),
  });
  return true;
}

async function dbCanAddAlbum() {
  const bal = await dbGetBalance();
  if (!bal) {
    // No balance record - create one
    await fetch(SB_URL + "/rest/v1/balances", {
      method: "POST",
      headers: { ...sbHeaders(), "Prefer": "return=minimal" },
      body: JSON.stringify({ user_id: _userId, balance: 0, free_albums: 1, used_free: 0 }),
    });
    return await dbCanAddAlbum();
  }
  if (bal.used_free < bal.free_albums) {
    const r = await sbFetch(SB_URL + "/rest/v1/balances?user_id=eq." + _userId, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({ used_free: bal.used_free + 1, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error("Ошибка обновления баланса: " + r.status);
    return { allowed: true, free: true, remaining: bal.free_albums - bal.used_free - 1 };
  }
  if (bal.balance >= 4) {
    await dbDeductBalance(4, "Добавление альбома", "album");
    return { allowed: true, free: false };
  }
  return { allowed: false, free: false, balance: bal.balance };
}

async function dbCheckBalance() {
  const bal = await dbGetBalance();
  if (!bal) return { allowed: true, free: true, remaining: 0, balance: 0 };
  const remaining = Math.max(0, bal.free_albums - bal.used_free);
  return {
    allowed: remaining > 0 || bal.balance >= 4,
    free: remaining > 0,
    remaining,
    balance: bal.balance,
    freeTotal: bal.free_albums,
  };
}

async function dbActivatePromo(code) {
  // Check code exists and active
  const r = await fetch(
    SB_URL + "/rest/v1/promo_codes?code=eq." + encodeURIComponent(code.trim().toUpperCase()) + "&status=eq.active&select=*",
    { headers: sbHeaders() }
  );
  if (!r.ok) throw new Error("Ошибка проверки кода");
  const rows = await r.json();
  if (!rows.length) throw new Error("Код не найден или уже использован");
  const promo = rows[0];

  // Mark as used
  const r2 = await fetch(
    SB_URL + "/rest/v1/promo_codes?id=eq." + promo.id,
    {
      method: "PATCH",
      headers: { ...sbHeaders(), "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "used", used_by: _userId, used_at: new Date().toISOString() }),
    }
  );
  if (!r2.ok) throw new Error("Ошибка активации кода");

  // Add to balance
  const bal = await dbGetBalance();
  const newBalance = (bal?.balance || 0) + promo.amount;
  await fetch(SB_URL + "/rest/v1/balances?user_id=eq." + _userId, {
    method: "PATCH",
    headers: { ...sbHeaders(), "Prefer": "return=minimal" },
    body: JSON.stringify({ balance: newBalance, updated_at: new Date().toISOString() }),
  });

  // Record transaction
  await fetch(SB_URL + "/rest/v1/transactions", {
    method: "POST",
    headers: { ...sbHeaders(), "Prefer": "return=minimal" },
    body: JSON.stringify({
      user_id: _userId,
      type: "topup",
      amount: promo.amount,
      description: "Пополнение по коду " + promo.code,
      status: "completed",
    }),
  });

  return promo.amount;
}

async function dbGenerateCodes(count, amount, note) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    codes.push({
      code: "VINYL-" + rand,
      amount,
      note: note || "",
      status: "active",
    });
  }
  const r = await fetch(SB_URL + "/rest/v1/promo_codes", {
    method: "POST",
    headers: { ...sbHeaders(), "Prefer": "return=representation" },
    body: JSON.stringify(codes),
  });
  if (!r.ok) throw new Error("Ошибка создания кодов");
  return await r.json();
}



const C = {
  bg: "#0D1B2A",
  surface: "#112234",
  card: "#162B40",
  cardHover: "#1c3550",
  accent: "#C8A96E",
  accent2: "#2E6B8A",
  text: "#EDE8DC",
  muted: "#7A9AAD",
  faint: "#1a3048",
  border: "#1e3d58",
  danger: "#7a2020",
  dangerText: "#e08080",
  fDisplay: "'Playfair Display', Georgia, serif",
  fMono: "'DM Mono', 'Courier New', monospace",
  fBody: "Georgia, serif",
};

const CONDITIONS = [
  { key: "M",   label: "Mint",  color: "#5aaa5a", bg: "#0e2a0e", mult: 1.5  },
  { key: "VG+", label: "VG+",   color: "#4a9aaa", bg: "#0a2028", mult: 1.0  },
  { key: "VG",  label: "VG",    color: "#c8a030", bg: "#281e08", mult: 0.6  },
  { key: "G",   label: "Good",  color: "#c06030", bg: "#281408", mult: 0.25 },
];

function condFor(key) { return CONDITIONS.find(c => c.key === key) || CONDITIONS[1]; }

const SEED = [{"id": "vin:1000000000000", "artist": "Pink Floyd", "album": "The Dark Side of the Moon", "year": "1973", "genre": "Progressive Rock", "label": "Лютеранская Церковь России (1992)", "country": "USSR/Russia", "tracks": [{"side": "A", "number": 1, "title": "Speak to Me / Поговори со мной", "duration": "3:58"}, {"side": "A", "number": 2, "title": "Breathe / Дыши", "duration": null}, {"side": "A", "number": 3, "title": "On the Run / На бегу", "duration": "3:35"}, {"side": "A", "number": 4, "title": "Time / Время", "duration": "7:05"}, {"side": "A", "number": 5, "title": "The Great Gig in the Sky / Грандиозный концерт на небесах", "duration": "4:47"}, {"side": "B", "number": 1, "title": "Money / Деньги", "duration": "6:23"}, {"side": "B", "number": 2, "title": "Us and Them / Нам и им", "duration": "7:50"}, {"side": "B", "number": 3, "title": "Any Colour You Like / Цвет, который тебе нравится", "duration": "3:26"}, {"side": "B", "number": 4, "title": "Brain Damage / Тронутый", "duration": "3:50"}, {"side": "B", "number": 5, "title": "Eclipse / Затмение", "duration": "2:01"}], "notes": "Русское издание 1992 г. Продюсерский центр рок-и-ролльных приходов Евангелическо-Лютеранской Церкви, СПб.", "thumb": "data:image/jpeg;base64,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", "at": "2026-05-25T00:00:00.000Z", "price": {"low": 5, "median": 15, "high": 30, "currency": "USD", "note": "Российское издание 1992 г. (заблокировано на Discogs)", "url": "https://www.discogs.com/release/9448134-Pink-Floyd-The-Dark-Side-Of-The-Moon"}, "thumbFront": "data:image/jpeg;base64,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", "thumbBack": "data:image/jpeg;base64,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"}, {"id": "vin:1000000000001", "artist": "The Beatles", "album": "A Hard Day's Night", "year": "1964", "genre": "Rock / Beat", "label": "Parlophone (PCS 3058)", "country": "UK", "tracks": [{"side": "A", "number": 1, "title": "A Hard Day's Night", "duration": null}, {"side": "A", "number": 2, "title": "I Should Have Known Better", "duration": null}, {"side": "A", "number": 3, "title": "If I Fell", "duration": null}, {"side": "A", "number": 4, "title": "I'm Happy Just to Dance with You", "duration": null}, {"side": "A", "number": 5, "title": "And I Love Her", "duration": null}, {"side": "A", "number": 6, "title": "Tell Me Why", "duration": null}, {"side": "A", "number": 7, "title": "Can't Buy Me Love", "duration": null}, {"side": "B", "number": 1, "title": "Any Time at All", "duration": null}, {"side": "B", "number": 2, "title": "I'll Cry Instead", "duration": null}, {"side": "B", "number": 3, "title": "Things We Said Today", "duration": null}, {"side": "B", "number": 4, "title": "When I Get Home", "duration": null}, {"side": "B", "number": 5, "title": "You Can't Do That", "duration": null}, {"side": "B", "number": 6, "title": "I'll Be Back", "duration": null}], "notes": "Саундтрек к одноимённому фильму. Стерео. Произведено и напечатано в Великобритании. George Martin — продюсер.", "thumb": "data:image/jpeg;base64,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", "at": "2026-05-25T00:00:00.000Z", "price": {"low": 20, "median": 50, "high": 120, "currency": "USD", "note": "UK стерео. Цена зависит от года прессовки.", "url": "https://www.discogs.com/master/27928-The-Beatles-A-Hard-Days-Night"}, "thumbFront": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCADYANwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDcl0K2ccN+YzVjR9Gjtmkjj8sCaRCxC4JChuP1q1uq3phzcgcZJ4z9DXJN+6dCWpehuLFbwaX9oj+1iPeIM/Nt9f6+tV/F0QXw/dgAf8e83b/pk1UhLbJ8QFtitwZTD5uDP8m/y8b9mP7vy7s4z2rT8Zf8gC64/wCXef8A9EvUxjaSBu6Z4C+PLLlwDnAXufetnwTlvEMKkcNb3H/ol6zbe8ktrc+W8QJflJIgxPA5BIrX8GzPP4ttncAFopsgKAP9S/YV6snJqSa01/rYxcYpJp6/15lHw3o8ut3LQxyrEscYdnIz7DiumXwFcAHbqSDPYxH/ABqH4XIGvb4sQFW2VmJ4AGetWtZ8fiK4eLSLVJUXgTyk4b3Cjt9TWVWrUVRxiKMY8t2QHwNeq2F1KIkf7DCnf8IZqi4CalH+b1DZ+NtavLiG3tdPtZp3O0Iqtlz+ddvo82qXB8rVdFuLKUnCso3xt+I6fjWbrVVuNRgzjrHwnrl1dXcMN+oFsVVpDK+GLKGwB16GqBttct9b/slbqb7Xu2jE7bTkZznPTHNelQTWVm96jrcQNM6tLdFSEDFdqgN2IA7/ANa463UL8S40a8N3ls+d8vzfuz/d446VpTrSle/YUoJWsTp4T8TXTqjasp5yT575H6Vrw6JrUNjDayXEDBG++srlm56lj9Tx0/KtXXNf0zQIElvi7O5/dRxn52x1x7e9c2PiXb3L7ZNOnSPPB81Sfx4FQqs2tgcI33Ev9G8RRkpaXUgJbIxdkYFZd3a+LbO3mne/nSGJd7sLvoBXYS6vajRxq+6V7fAMixqHeLJx8wB4rlPiDr0Labb2VlcLKtyBNI6n+AfdX2OeSO2BRGrJu1l9w3FJbnPJ4k17cqw6pflmIACykkn0rVlu/HqqVeS9kjPVJAj/AKGud8Ks0niPTR63Kfzr1HWNY07SPl1C8ijc4Ii+8/12jn86urNRtaK1FFX3Z5/cReIG+e60tZSeMvYxn+S1kz6fqK5LabKrHssDAV3T+MNGdgBPMM/xeQcCti2lgu4FubSdZom6Oh4rP2zX2SuTzPImS4jkDS2TlR/C0bgGpI7q1wQ9gh46idxivXHjEcJkdwqJyzM2AB7muO0oWF38RsxiG4t9pkG3DKXCdfQ81UasZXuthOLXU4+SaNZCUTap6KXyR+OKq3GyeZHJPyEfKCMV7ZrWpaTpsXm6kbeIH7qsgZm+i4ya5238U+FbyQrNaxwDs09quD+QOKSrRa+EfL5nN2PiiO1tY7cWTFUULkSjn9KvReMLWQlZLSaNQpJbcG7eldXa2fhrUlDW0GmzBjjKIvHc+9eT6lLC+p3UlrGqW5lby0XgBc8Y/Cs1GjJ/CXzzXU7ey1+1vIrqSNJkW2h8+Tco5Xcq4HPXLCmR+IbCQE5kXnoyj/GsDQQDpHiJ14YWKLj6zx/4VloxC4PBB6GtFhKbbQvbzPZN9X9F+a8z2UZrJEynvWloD5vGCkfcrkn8LLW4+O/WLxxPai5nJniXMTKmxSEyMHO4cDJOMEmr/i/nQLr/AK4T/wDol6x7W6SLx5LZvcz3EskZYb4osRLtDBAcb8cfT1z1rb8Wr/xILr/rhN/6JekviQnszwawuZYYiscMcgJZiXiD4IX9K1/BsjS+MbZ3RUZoZSVVcAfuG7dqx9PluI12w3n2ZCxydxGTtzngdBj9a2vB5dvGkBklEzeVNmQZIb9w3PNeg0lOWi2YSbdGOr3KGi3UlrourNCxV5IYYiR6Mx3D8s1mDkVq+GtHuNYsdShtMGWKGOYJ3faTwPfmsw/LwRg+hoq/GzBbI2fBqyf8JRpfkqDIJwQGPB4PFe12Uk62UX2xQLnywZgvQNjnFfPkTkSIQzLtOcqcEfStZnsJrJpftd7HOvAidy4b3B7VhOHMXGVj1/WdasbGxuGvZIpE2ALBkMZdw4G3vmvJPB9zHZ+Ire5kUBIVlkKg46Rscf0q14b0S71l5pY7oW8VrD/r5wSApyAq/r06VU0fSTdeIEsbeZZFmjljDYxtfy27eme9aUYqKkvImbvZmdq1/c6nqEt7dtulkPTso7AewqbRJlh1ayme3+0BJQ3lY++ew/PFJJpc8Vu0kyFZEYhkPUY4IqG0leC7hkhk8qRXVkkP8BB4P4U+liT3+S2ivLaM3VtGWkjUvG8Y4OMkEex7Vwvijwjp+oxyDSI0tbxHbagXEc+M5A9GyD0rOk1Gd9IXULjxdeOJf+XfZ824HOCAeBkflWA3ieSeZP7Zt/7Q28xymQxzRZ/uuP6isIxa2Zo2iLSrX+yde06ZmYSxfvpYZIypjcBvkOfoPzrIuWluriW5uG86aVi7u5OWJ71t6rrDazr0E0TyzEWxQNOgD8I/3scE+4xn0rnEdiBk8V0S2XoQi1aRK91bJOQY2lRXGccFgDXtOgWdm9pI0Wlpp6mRlMWwKcKSBn1+teK2rmKeGUKr7JFYK/Q4OcH2rqZ/FviCYu8WrqMrmVWgVRGST8q8HIHrWE02aRdjrPHXhe61qzjXS7o7oOTZscLKT0Of73oDx9K8/wDAk0en+JJLi7BWO1tZ3kGORtXp9c8Vo2nibxDLq1uLa4bUJY12rFCn+t4OGYD/AHupx0qhp2j3767rGm3KD7ebCZ2RWzliFfGR3qqaai0+wpPVMwdVv7nV9SmvrxsyytnHZR2Uewo06xm1C/t7O3A82eQRrnoCe59qYUGAQODV3R4ruXU7ZNOQvdl/3Sg4yfrR0EejaR8O7y1tNRsrm+hMc6KYLmDIdH5DDB7EYB55FeY6np9xpd9PZXkeyeFtrL2+o9j1FfRekrLBplql2QbgRKsmDxuA5rzP4nnTtU0yz1q1ljFzv8iRAeWG3d+O3I596yhJuWpbWhyekBf+Eb8QnOMx2y5/7bf/AFqo2cM7xEqxIDYzx6CrmlnHhbXz/tWg/wDIjf4Ve8KorafKWxnzj1P+ytdsnZN+f6GS6GSni/UU+9GT+Fdt8MfEM2ra1cQzR7QluX/8eAryL7TOP+WhrvvgxcSSeJrlXOR9kb/0Ja5KsVyM0g3zHt8UURlE3lp5mMb9o3Y9M9aqeKh/xILv/r3m/wDRT1dg5HtVTxWMeH7z/r3m/wDRT1zU/iRpLY8Bs4IJkKXE/wBnYHKyMpKnjkcVteCtn/CXQeVu8sQzBSwwSBC/P41QtmdbQbbGO5+c8shbbwPStPwlJu8YQbovKJilHl7cbf3LcYr1G25T7Wfb/h/vIlFKnHv8/wDhvuL/AMKZPKvr49/syf8AoVbmveDbTV7qS7tpzZ3MpJcbNyOfUjqD9K858OX2qW2oK2jRvLcMmDEse8MvuP611w8QeNIzltBJ/wC3Z/8AGorUpOpzJozhJctmNi+G99kbtSsxk4+65/pXUaN4G0nSxHNdbr65RtwZ/ljBHovf8a5tfFHi1T82gE/9u8n+NSHxj4mH3vDxP/bGUVm6VV9V96KUoHV+LfE02gWUTW9mZfNOFc48uMjnBHuM1w/hjVJdS8fW17MkaSTSsxWMYA+Q07V/FWt3+mz20+hPAjLzMqSDZjvyMetcjpmpXGn6lBf2pHnRPuUEZB7YI9wcVrRoSSd+xE5ptHrXi3QJb8vdaaEMz48yI/KHx3B9a89vPDWrQMWOnXIHtHuH5jNdIPiHf7Bv0M57kM4H/oNIvxFug3zaK4GecSMP/ZahUqqVrBeHcx9M8E6xqCebJGlnF2NwSGb6KOfzxXV6Z4Q0ixtJobtBeyzKEeVxt2j/AGP7p9+tZ7/ENmBzo7gkf89D/wDE1X/4T3t/ZL5/66//AGNJ0qz6FKUEZVhpf9jeP7GyZhKnnBkY/wASFWxkevY1d8ReA5o5DcaEPNiYkm2LANH/ALpPUfr9axL7xHLN4og1j7OitBtxFk4wARgn15roj8RYgMHSp/8Av6P8K0qUqnu2XQmLjqcwfD2tRkK+l3YPtGT/ACrX0bwTqN7qFvDqQ+x2zqXd9ylwPQD+8ffpV+P4hQk/8g64GP8ApoP8KjvvHWnXkDQXWlXDxuMMvmDn8azdKr2K5o9ztdHOj6XZXdpoEaTyWi5mjhYNLIw/vHuf0ri/BepLqPxKu7+LzAskMpXzD8wACjn8q5fw7rkGieIv7RS3ke2HmAQ78MFIOOehI4qzpHilLPxbNrc9oBHOHDQwYGwHHTseg+vNVChNKWnQTmtDpfGngW6fUJL3QIBLDKd72ysA0bHrtB6g/pXNWfhXxHNdeXDpV3FIhzvkHlhf+BHH6V2Q+J2jZ5gvRn1VT/7NUg+JmiMqgreDH/TIf/FVn7Oql8JV49yla+HPFc1ibbUNcNrAG/1TSmUnB68dvbNcf4p0WTQ7tIGnM8ckW9JNuMnowx9f6V3Uvj7Qped92vPeHP8AWuc8Za9pGtadGlrLKbiF90e6EjIPBBP5H8KIQqX1QNxtuY+m8eEtcPrPaD/x6Q1f8KjOny8Z/fH/ANBWqelRGTwlrC5Azd2nJ9hJWn4XWNLCVVG7Ex5PfgV0VHZS9SI7o8zyvbNeg/BNVbxVcgkg/ZGx/wB9LXnpJ/vA16H8DwT4quT1xZn/ANCWuWr8DLh8SPeYQFHArP8AFxx4evSP+fab/wBFNV+LnGCM1m+NG2eHL0L1+zT8/wDbJq5aXxI1lseF2Kt5TXJHmmNsRRZHL4HJ9hxWh4OMo8aWgnYmVllLE9cmJjXPbJXCoiM5J4wueTW34FDp4z05JVKurOuCMEfu24r1pRs5O/RmTneEVY1fhIR/a14D/wA+o/8AQhXeaz4o0XR5GhvLomcDJhiQuw+vYfia8v8ABd++kprF7FjzIrEbM/3jIoH86592d3d5HZ3Y7mZjksfU1z4iF6rFCVonrK/EDQioJe7Uk42+QTj8jW3ouuWGsIzWF0JNpwykFWXPqDXj3hg2o1+w/tCCKa1aZVkWXO0AnGTjrjrivatM03Q722gv7TS7VFlAeMiHYcZ4zjFc84qJabZl/ELUGsvCVyquwa5ZYAc9QeW/QH868z8ERLJ4r05CAQZCcEf7JNeleNfCA1yB5rGeUXkI+WF5SY374wfuk+o/GvOfA48rxpp4lGwpIwcNxtwjZz9K3w9uWVuzIqbo9gmaK0iM13OkMS9XkfaB+dYEviXQTJsGqw8nGcNj88VwHi7xDL4h1N5NxFnESttH0AX+8fc9f0rGwpZdx+XIzz2rJQ01G5HtYlgGxjcRgTD90S4Ak+nr+FV9Z1CPRtNnvZhloxhEP8Tn7q/n+gNKvh/RtS8MxQwXN42muFZMz+YVKnjbkHafYY+lcz418Na61lG8F9Nqdla7j5cigSp2JOPv4xj1FSkrlXZy3hMm+8Y2b3eJmlnZ3LjO5sE5/OvYGQbSSAR7ivGvBMqReK7OaU4jj8x2PoBGxqLXtevNcvXmnlZYM/uoQ3yovbj19TXRWTbj6EQdkz2RZLcsEEluWzjaHUn8qkaNQcNGv4qK8b8NadYanqHl6hcm3hRTIxRcFgqkn5jwOmOfWvYNO0uG00+K3s55/LABR5JRNtHoDjkf5FYNWLTuKIImP+qjA7koOleZ+G4NO1f4gXckcEbWamSWGPb8pwQAcfiTiuw8eya5p2jzvp0UEtlJGUmmXd5sKngnGcY7ZHTNcJ8ObiOy1m9vJsCK3sJZG+gK8f0rajdRk/IiW6PTtQGkadEJtQFlBGTgNLGoz9BjJ/CsiTX/AAb0M1g2fS1J/wDZa8u1TUbvV717u9lZ5HOQCeEH90DsBW/4Cg0eXVRHq9t9peVligjcHy9xPJPqfb61ny2W47nodlbaBqsHm2Ftp9zHnBKwLwfQjGRXkviqSGXXb02sEUMEchijWJQq4XjPHc4Jr2pPD+mQReRaxSWkQdpALaZ49rMACRz6AcdK838SfD+805buaynintYkMqB2xKVH3uOhI+vNFOdpbhJaGNprMvg7VGRsN9vtR1x/DLWp4UWQadINuP3x6kDsKxbI/wDFHar/ANf1r/6DLW34QO7SmLtk+a3U+wrrrfC/UiG6PMCrY+5Xo3wMXPia8Rh8rWvIPf5xVs+HbQ/8usf5V0fgDSYbDW2lgiVC0W0kdxmuKpO8GaxjZne32q6dpeI727gtyIzLtc4+QEAn6ZIFZniO/s9S8LXd1p9zFcwGCdd8TZGRE2RXK/FS31GTU7ZrKymnimsmgkaONmC5kB7dDwKs6dp76Z4K1e0MUsaLcXojEgwWQRMAffp1rOnFKzG3rY8v02XZunaQKI9xAJxucrhceprT8FZXxtpMbMGYPtLBsgny271iwRNNaiKJyXLkiL+/wOR71s+B7aS38a6MsilT54ODwRlTXoOMVKbvrbYUpS9nFW07/wBfIz9IjuJrbU4rVS7fZgzqOuxXUn+VZoOeldb8MyV8RXAH/Pu4/wDHlrV8R+AJp7mS70RoQrnc1q524PfaemPY1GIklUszOCfKcPp90LO+t7gxLL5Th9jHhiOQD+OK9Cg8aeJbi2M1pZ6Q0CL82zIWP2OWGK5WPwP4jkORpxGDjDTIM/rXT6D8N5Sqvrl6Io9wLWtsdxYDszdB+Gawk49Slcs2fj64tBLeal9lk3RiNbW2fLmVR949lU59/auE0ya5vvEUk0fFzcCdxt/vNG5wK9R1nwPotxpU0GnWMVvdbSYZgzEhuwJJ5B6fjXnHglXh8backqFJEnZWU9VIVgQa1oNe812ZM76XMRDkD0xTznNdR458NyaXqMl5ZwH+z5juBQZETHqD6DPSuW3KTww/OpTvqFrHpGkeMtUg0q1tdM0CBooYAARMSWOPvY7ZOTiqkHxBvra4lnntU8qSPIiDctMAAW9hnP6Vymk2GragkkelW88sbkCQoMJntljxXQ6l4EmtdA+0rOZdSjBeaFTlNvop6lgOffnFQ1FFXZy2kux1OaXaCTBOxXHHMbf41XMMax4LfMK2fAcaSeKrRJVDo6yhlPQgxsCKd4j8L3ukXUhghknsuscqJnaPRsdCP1raq9UvJExWhJ4L1G10tNTlnto7u4lSOK3t5OjMWJLE9lAHJ9662z8SeJprgJHo+mrBBkuwmKoyrkFVOcduMA9K8uWZoX3RuUYAjIODgjBH5Eit3RfD+u6zFbxQxzRWAbiWVisaA9SAev4Vk0hpnQr47ki0W+tdRiEk86utusTDaFfdkk+2ce+K5LwzbS3UetRQgs405mAHUhXQn9Aa2vFfgn+xLB7+2vjcwrKFZXi2soPQ5BwfT8ad8KDt8R3ZH/Po3X/eWtKdlGTXYT3RyC47VteHNafQ7t7iO0trlyP3f2jOI27sMdDjit3xf4KuLW9e70W2ee0kO5oYhuaE9xjqV9PSsOHwxr8wBj0e+IIyMwkfzqLpoZ0T+PdVuYnSewtkikR1O3dk5GB1ParVx4qtb7QLpJRdTXcsT7oUQDynwfnDZ5XHX8eKseD/AANJEXu/ElujLsKxWkhyc/3mweO+BWJ470BNBne6s4M2F0m2P5iRA/cfl0z7+lTHlcrDd7GBYj/ijdVH/T9a/wDoMtbPhSOT+yv3abh5h5xn0rHsv+RP1Q/9P1sP/HZK6nwNdmHRnUf892/kK7K3wv1M47o2Qo9K2PC6qNS5H8BNYIlb1rY8LSM2rID3U15k/hOlbmJ8XbqS11K2EaM3n6fJESCRj94pz+lWPDl01/4J1e6dDGZbm7faSTjMLHFdV4k8W6b4clgi1FLhmmUuvlRhuAcHOSK5rQb1dR8K6/dRtI0U17dvGJOqqYWIHt9KuD91aEvc8us52ht2jtkzcSNhWHLKuOcfWtnwmk0XjnRVuM+aJ4w2Wyeh71h6beSwZjiVzvAy0S5kAHp7e1a3hHC+N9E2vvBuozn6k8V2yVqktOj9X/l6A3eitf8AJf5+vyKvhzWV0DW2u3i82Mh43UHBwT1HvxXbD4k6Vg/6Ld5/4B/jXO/Dy1t7jxe4uYkkEccroHGQGBABx+Jr1SZLO3iMlxHbxoOrOiqPzNTiZU+f3o3fqZU1K2jOOj+JOkr1t7sfgn/xVTD4m6Lt/wCPe9B/3U/+KrpoW0u4cRQ/YZJCNwRAjMR9OtXY9Kt5MF7S2Uf9cV/wrn5qP8r+8u0u5xw+JmibMGC9z/uJz/49XF3HiGBvGS67BZGOIShzDuG5uME56ZPWvXNav/Dvh+3DX0FqZCRthSBGkY+wxXkWiw2Gp+NYIooW+wT3TMkUg5CcsAcV0UJU/eaj07mc+bTU7X/hZGiBTmO8+YdPLX/4qs6fxh4UmOZNOLk/3rSP/Guxu7bSLCMTXsdhBDnAaWNFGfTpWZPrPg6P71xpxz/ct938lrFSpdIv7y7S7mWnxA0ZIlihjuUiThUSFQo+gBpT4/0gEMVuv+/Y/wAa6eztdHvrcXFjFYTwHo6RoRn0PHB9jSyaZZBgPsNtx/0wX/Cjmpfyv7x2l3PJrHXLPT/Fh1a1tnWz81iIcjcFYEHHbvnH4V2i/EXQw24x3n4Rr/8AFVhxafYH4mtaRwxNbqWfygAUDiPJGOnB7V6ANLsfKZzY2mAMljCgA+pxW1WVP3broRFS1OYk+ImgMf8AUXGR0JgQkfjmlb4kaIV5F4W/65L/APFVuRXPhlCUMuilumCYq0U03S3b93Z2jL32wIcfpWXNS/lf3lWl3OC1vxzomo6ReWfl3JM0RVNyAAN1U/e7HFcp4T11fD+qm7khMsTxmORVOCASDkZ9xXp3jG503QNHllWzszdzgx2yGBOSerYx0H88CuF+GNnb3mvXAuYY5hFblkEihgDuAzj6VvTlT5JaESUrrU6dfiXoYwfLvQR/0zX/AOKqX/hZ+iHqt7/37X/4qukmtdLt7dprmCyhjTgySRoq/mRWauq+E5GZFutJ3L/sKB+e3BrC9L+V/f8A8Av3u5nj4naEQBtvP+/Q/wDiqzvEXj7RtS0S7s4La4meZNgWVAqqezZyenWuztrXSrmNZYbaxmjb7rpGjA/iBXl3xHuIH157S1ghijtE2HykC5c8tnH4D8KqHsnLZ/eJ81jPs/8AkTdS99Qtv/QJK0fDU7R6cQD/AMtW71mWh/4o6/8AfUbf/wBFyVf8OEf2cc/89Gret8L9SIbnVjNbPhTP9rp/uNWWFrX8MDGqof8AZNebLY6kUviRqFtpmu6JPqFql1ZeXL50LRIxYZHQt06jvVrTtV0nV/CN9LomnixgRpkeMKq5byHOfl46Yqv8Sry007VtBvrq2e6MPmkQYXY444OQfX0qbS9dtte8KX89npiaekbSoY024Y+Q5zwBVw+FGb3Z5Fpn24wMdPSUsWAdouoGOBmtbwyJl8d6L9pUrObuEuCOc561zMTSFQibvXC5yeK2vBcjN4y0PcckXsSj6bq9CVNqUpabdtfvJdROmo6/fp9xpeCb6HSvEl5eXTBY4oJ+vc7hgficCs3WtXu9avnur2TcSfkjH3UHYAVWY/6RfAer5/77FVww3DH41jWXv3FHax6R8JbNIjqet3GEhhj8gHbxzhmP4AL+davjXWvEcWmSXOmwx2tirFJZRIGnQ5A5X+Dr05I74rhfCKa3fS3mnaK7eXPCfPUvtRRkYYk9DnpjmtHxJqksUV5pEqyTRrNvafzWdfPJ+cltq7sY4BGM5PNc7XvFJ6E3hTwvrOpabd6/Z30sF78y2jMAWmOMOdx+76AjvmsDwaj2/jfTorhWjdLgh1cYKkK2c12i/ECTQoRpkuiPbeQkaQRNJnEW3hie5PXj1NcXDe3HiHxv9p2rHPeM4VV4wTEyj+lbUb+9fsyJdB3izXm8Q6v5yBktIhst0J6L3b6nr+QrFfrTEBQ4YEMvBHoalmVVPyHKnoTUJWHcYOvBxn0ro7PxtrNlp01kJRNuTbFNNkyQDGPlPf8AHOK53Ix3pkmKLXA0vCepJpniH7fcZcRQStjuzFDgfiTUes67qWsSFr65kaMklYQcIvsF6VV0mEz3tym0MRaTPgjPRc/0qDNa1Err0RKJ7G3+1XdvbBgnmyLHnbnGTjpXtem+HbIWEdpFqV/MllOTHL54BjZRggED7vPQ5FeJWshiuYpFYoUkVg393BBzXpsfjrQ7KKW2stIvGgaRpFGVCuxYnOCeATzjt6VlK5SKnjnwRqDK2q2d9c6kqL80dw26REH90jggemAfrWH8NLuDT7/V726bEVvZFzjqfnGAPcnA/GtiX4iXcN3dyfZdsU65WFpclH2qvXsOOlcZo8Us9hrrRZPlwxyOP9kSjP8AMGtKd+SSYnuibXtbvdevftF6+FHEcKn5Ih6AfzPU1Y8Mx6bHqZfVoftECJxEX4ZyQB05PXtWKCOKvaTftpt/FeRQQTPGThLhN6HIxyKgZ7ZHoNnBYi106a5sIvmZPs0uMFuv3gfyryXxr4YufD0weSU3NtPkx3OMEnqQ3+13962J/H3iEtE8iWccbEONsZ+Yemcng1ieI/FF9q+kxWF35ZWOQyl16k4wB9BSgmpDk1YpWxx4NvD66lD/AOipKtaAf+JeOcfO386pRHHgq499UjH5RN/jVrQ/+QcnPVm/Dk101vhfqRHc9A21peHhjVI/oapYrQ0EY1OP6GvNlsdKKPxQt1lfTZE1M2M8EVxKGEbklAFLYK9D7d81W8K27WvhbVrR9QN40Mzrna4CZt2OBu+ueKf8WbaSf+yvKvbW1LedCTcTbNwYKCOh4x1qt4IidPDGrtLe2148ly+54JC+CLdhzkD0H4VpD4EZy+I8w0w3yws2npLvJAdolyQMdPb/AOtWr4aEw8c6G11GUma8hLhlwSd3XHvWNYxtJEUFx5THGxefnbHTI6DHetfwuFXxroSLOJ9t5CDIucE7+2etdzt7SW17dnfbuN39it7eqt9xo+AoIbnxlcwXMSSwvHcBkcZBGag8T+FLzQ7p5Io5J9PY/u51G7aPR8dD79DUPhrVrfRfFst5eK5g3TRsYxkrknnHeu/HxE8PRjC3c/4W7VnXjPnvFX0MotW1OP8ABvimPRIbu1ePCXDLIJoz8yunRT/snkH0zXc+GtN0LVru81a0lnxccXemy42q5OeR3XPI7H9KqL8RPDKKVRnAb7wFpjPrmufk1jwMsnmaedUsJgOJbPcuPwZiMe1ZeyqP7LK5l3PQ/Enh7TNdET6jAXeH7rxvsbb3XI7e1eWaTpU2i/Eews5h92fdG2c7oyrbT+Ip7+NrmzvIWt9cu9RtEfc0NxAsTMB2LZORVbUvFNtdeMrTXIbaRYIFjXy2YbiFUgn07nH0rWjSqK6a6MmUos3/ABz4NnFzJqmkRNMspLz26DLKx6so7g+nauKFhfyBVj0+8PpiBzn9K9GHxL0MDGy8/wC/a/8AxVH/AAs7R8YC3/Hoi/8AxVZqnV/lG3HucOvhXxC4BGjXnPHMeP5109l8NJZNJeS9vRFqDpmKFQCkZ9Hbvn26e9Xv+Fl6Nk5gvj/wBf8A4qhvibo4GFtb4j/cT/4qj2dXsF49zk/Atq8HjhbS8i2ukc0csbj/AGCCDVrxJ4IvrG6kl0mB7qyYllEYy8X+yR1IHYisyPxUo8aPr72x8tyV8oN8wXbtHPr3rrv+Fk6cBj7Dfc+gX/GtqtOpdWXQmLicAlheyTeTHZ3LSdNghbP5Yrs/DngW7nkE2uOba3bk26N+9c9s9l/n9Ktf8LJsc5Fjfn/vn/Gm/wDCx7LPGm3/AP47/jWbp1Ow7x7mt4m8L6X/AMI1cxabZRRT26mWOQDdI23kgseTkZrl/hMscmraqkqK8clrtdW6MC3IrQm+I9uFJj0u8LAcBiAD9fauS8KeJP7C1ae6+yCWK5Uq0URwVG7cNv0rSFKpySTQnJXRp+JfB9/pV4zWFvNd2LnMbxKWZP8AZYDnI9e9UI/DmuyKAmj3xDdCYSP5114+JVsv3NH1Dj3FNb4lI3TRb8/iP8Kz9nU7FXiT+F/BEMVo83iO3WSWQr5duJCDEBnOSp6njjtiuR8c6IuiamyQbvsk6+ZBuOSozypPsf0xXSj4iMx40C+P4/8A2NYXi/xOda0yO3k0e4tikgZJpSePUDgdf6U4U58yuhNqxkjjwU3+1qv8of8A69WdFONOj+rdvc1VfjwXBz97VJP0iX/GrWkgf2dDz/e/9CNa1fh+Yo7noZuoh/Ev51e0K5jfVIlUgnB6Vy+6tXww3/E5h57GuCS91m6epF8ZJIY49KaePzAyXKqM9GKKFP4HBqLwDLBN4d1l7SLyomuAFT0/0Zgf1yfxr0HUjpG2H+1/sR4YxC6CnoMtjPoBk1SvZNLfSrhNIa02oSZFtgoALQsVzj1BB+lEJaJCktbnz1ZXUcEX7y2SY8EbmI28e1bfhkf8VnoBNv8AZwbqAiPngb+DzzzWHplzHbHc0aGQqNkrLu8s+u3v/Stnww0jeONDaWUSl72JgwbdkF+Oa75L943bp3eunRbfqK/7m1/wWnq9/wBC54NsLbUfHEkN7Es0KtPJ5bdCVJxkdx7V6n/Ymk5yumWQ9/s6f4V5f4Huo7Txne3U+RFDDdSP9ASap674m1LW5nM87x2xPy20Zwij39T7msq/M579CIWSPWZIPDtsVWZdIiLfdDCIE1PaWuk3KGW0t7CaMHbviijYA+mQK8q8C6fp+qa6LXV9/wBlWGSYhG2higzhj1xjNewaN4f0XTlWfTbJIPNQNuV2O4EcZycHg1zy06lp3BbOwt43uJLO0WOJS7kwLwAMnt6V4zoflap8QLV5reLybm8Mhh2gKAckDHTHSvXfE/h59Y0+aKz1C4tZGXGwSHypPZl9PcfrXkXhaF7Lx7p8N2PLeC5Kyjrt2q2f5VtQfxehE+h6xrV3pGhWn2jUEgVWOI40iUvIfQD+vSuS/wCFhaWJcjRZAueoMef5Vxuv6tPreqTXs7sysxESk8ImflA/z1qLS1t31SyW8Gbc3EYlAHVSwz+lQo6ajcj1YeJNMTRf7YS0M1vx5vk+U7w54G8Z45rkviD4hstQ02ztdLljkjmPnSlBgqBwqsOxzk49hXpWk2mlatpUNyml20cUilfKe3UYAPTGOmRWB4k8FaLqokt9OW2sdRhAP7pQAQRkB1HY+o5qE1cbvY82+HlvHL4ytFkRXASR1DDIBCnBr2docKG8sBe/A4rx/wAEkaZ43IvflFpFcebg5xtQ5/lVHXtfvtcu3muZXERP7uBWISNewA/rW9ZOTXoiI6I9mE9tJJ5aTwGT+6JFJ/LNSkeo6cdK8Y8K6VZ6pfyJeyskcULS+XEVV5SMAKGPAJJHJr2u10kQWdvDDcXQWMDaZHDsV/usSOcf5NYtWLTuV5pY7aKW4uG2wwoZJD6KBk15x8LvKufEerXCxImYyyAL9wNJ0HpxxXRfEO019dLna0khm0puZ1jixKig55OTleOcfiK474e6kukL4gvzgvFaqIwe7l8KPz/lW1P4JEvdHpet65pmiBf7Qu9srDIhjG+Qj6DoPc4rAk8f6IHGBfnJ6mID/wBmrzOaWW5nknuHaSWRizuxyWJ7mur+HdwkWqpClgJpZnCtOV3eWmORzwOnX/Cs+VJDud7pWp22sW5uNNnM0YO04BBU+hBrifiZrKSRR6VbTCQI3m3BVsjd/Cv4ck/hXoV3penT2zw3FnGYmfJEY2YY4GQVxg+9eR+N/D//AAj12I4pDJazrvgc9cA4IPuPXvTp25kEtihcHHg2y/2tRnP5Rx1Y0ot9ghx6H+ZqveEDwjpIIzuvLpsfhGKvaKM6dFjjrXTU+H5kR3Oh3Vp+GnxrEH41jbq0/Dbf8Tq2GepNcUtmbLc1/ijbahNb6W+m2zzujzK2BnCvHt9fQmqngi11CLRNWbUrcwySSRhQcchYGUdCewFP+MS239mab9pWdj58mzytvXZ3z2+lU/hl9lOh6strHOh82Pf5pXBPluOMAcfWiHwCl8R5bp7wKmy5tzNuZcfOV28H061reE5IpfGegNBD5KfbIfk3Fv4/U1kWt4baP5IoXY7eZEDYwO351reE7hrjxroLsiJ/pkIxGoUcP6Cu5wlzuVtPXy7bC5l7JRvr6L89yor7NQ1T5tpKygfjIOP51AvWtrwvpsWs+Kb2wuHZElS4+ZeqkNkVn6zpd1omovZ3qYkXlWH3XXsw9qzrP3reRnHY1vBuo2+m60s91bPdKUZEgQAmR2BULz2O4/pXeTeIfFtxHHFYeHreCJkxGXfzMAceoHGP0ryWKV45FkiYq6EMrA4II5Brq/BkutXN41vpayTxFt8yM2EB65YngZOfqawa6lJnT3HjHUtMa4uL0WxLJs+zLkFZFGN3+6SK88097nV/FStuzc3TSHPqzI1eha74H+1abPdPeSSarsLiKPHkkjogyM9O/rXAeCTt8baSeQRP/wCymtKNvet2YpX0KK9BxilJ7V3fjvwlP9q/tLRrVpIpuZ4YVyUf+8F9D7dD9a4t9N1HBzYXfHX/AEd+P0qU7jsdgvi/xRc2stzDqlnHFGoWQJEAUyMdxkn3HesNvFGpw6pHqAuVlnjjESyMmCwClQT7859zT9F8Ha7qsZlSAWtv/wA9LnKbvoOp/Kusn+HVvH4buY4ZTc6qf3kcxG0Er/yzUehGevfFTdIep55o0zSazfTzAzu1lcs+7+ImM5J/PNU8cVvfDmNJfG1tDOgeN4Zo3RhjKmMgg/mal8T+ENQ0O7kNvDLdWGcxzxoWwPRwOhH5Gtqj1XoiUtA8GanbaTLfTzWqXVy8Kx2kLrlWctySewxnPtXbW/ijxO8sbT2elWcCZYySu21wMgoCCeeO3pXk6uyuCuQ46Y6102heGta1VLdZI5LbTd4JeU7RjuVU8k/hWTSKRqL44lg0fUbKdFuJLncsRViEjVixYYPPG7iuV8PWsl3pmviEEtDFFMR6qshz+hz+FdL4x8HWmlaa+oafc3DqkoDRy7ThSccEY6HH51B8JSF1HVCcHMKcHp941cGuSTQnujk8j1rS0jW7/SknTT7yS287Bcx4y2M4Bz25NbniDwXcC+eXRlja3c5ERcKYyewz1FUR4J1jIDfZV+s2f5CougsyKfxFq7O3navPKSmz5nzgEg8e/A5rM1rU7zUoo/tkxk8lBHHnsua9E0LQ7TR7B47hYbqaVg0jPGGUY6BciuS8b6VFbn7bZRrHBI+141GAjeo9j/Oqg1zIGtDJ1IY8L6GO7S3Tf+PIP6VreH4ydLiIXP41navG39geH1/6ZXDfnKf8K7nwX4bubrw7bXCp8smSPzx/St56x+bJWjJZL/whB90TTH/gRqbRdZ0S41i1trGxaOR3wsjDpxn+leeljWv4NY/8JRp3/XX+hrznUbR0qCR2nxX1C40230O7ti5KX24xqxAkwoO046g4q94a8S6h4ksLw3+k/wBniGWMRja437g2fvAdMDp61peIbbRLx7H+2roQtaTi4hBmEfzD69RU2oeJNFktwg1azZvMUkG4XpnnvTi9ErEPc+dtOit5CftDN8qjbCnBlPpk8D/OK2fDTF/HOhnyVhCX0KqijAAD/wCear2/hbVbjiFbST2W9iP8mrZ0TQ9V0zxJ4fn1JY/LGowQoyTrIQd24A4PHGa9GXK5OXNchS9zlt/wSl4U1G30rxnLcXj+XCXnjLnopLHGfbivQr7XPC+oxCLUbzT7iMHgSHdj6HqPwrz3w1pVvrXjGeyvd5gEk8jKrYLbWPGa9FHgjw7H/wAw0H/elc/1rOv7PmXNe9iYc1tDLjf4dW5dgtlIW/veY4H0HatOLxp4ZtLcW9ndRQwr0jht2VfyAq5D4L8Pn7ujwH3O4/1qyPCehRKp/sezByeDFnpWN6XmX7xiS+P9AGf9MlJ9rdq88fVrG18aDWLGKU2a3HmhGAViCPmwO3JJFewJoGjqp2aRYgj/AKd1/wAK881bSNO/4WfaWEdtGtrI0bSwKMLuKkkY7A4HFa0XTu7J7EyUjfX4laEqjH2xj7RAf+zUx/ifpefkivyM8YC//FV1d8mladYtc3kdpbwJ1dolHPoOOvsK5Z/F3hkAgM+SeMWp/Osk6f8AK/vHr3IT8TtOxxZX7nH+z/jTJPihaIPk068HHG5lFby6rpq6bHqZ81LNvuzm2fbjpnIHAzxmvNvHWoJqfiS4e3kWS3iCxRMpyCAOSPqSapezf2fxDXuV7LxGbfxgdcgsVy8jH7MrHncMHB9TnPTrXbH4gXTL+68OagD65P8A8TXG+AUVvGNmNoOBIRx0IQ8169dXVvZQNNe3KQRjjMjY/TrWlaULr3egop9zkT431FjuTwvdk+pBz/6BS/8ACY65Jyvha7JHqW/+Jq+/i/RFJX7XKwz1WFsfWrlrremyxxyi5KQykqk0sbJGWHbceAfY1jzR/l/Mqz7nMarr3iG/sLm1bwvKsc0TIWJY4z3xjt1rlfBt5rFnqE39j2f2uSRMSxMOAAeDnIxzXrmo3EFhYm9ncLAq7g+fv+gX1z2rivheTcaprM+3Bfa2OuMsxrSFRckvdE4u61LJvvGjHI0K1Q/7Un/2VRtJ43kP/Hjp8f1cf/FV0+veI9J0Z/Iupme4/ihgXcy/73OB9OtYK+OLKeULBpmoSKBligViB9B/jWfP/dRVvMpNb+MZFLO2np+Irn/FcWt20NumrXMDxysSiQnuO5GB613763pgs47ue5FvDIhZFlUh2wccL1PNebeLNW/tjUzPGCsCYjhVuoUdz7k5NaU5NyWhMloP1qd00rQF4/48Wbp6zSf4V33gvxnfaboEFmtvbypESFZsg49OPfNef+ICqQaGpBJXSojj6u5/rWxoT/8AEuQherE8Vc37qFFamL5la3hBifFGmA55uAP0Ncv/AKW/UkfjW14KjmTxZpLu4OLleDzXn8rsb8yOn+NiD+0tLOB/qZOv1WvOo49xUKvJOBXrPxRsI9Q8QaLBcPIsJilaRoxlgoKkgDpk9OeBUeuaN4bttPitdPtLSK6yA4ZybhSR8nOcZz17AVtCVopGUldszvh9EYL1wwZfLRhJsbGMEDt2z6Vu+IEMeoaG7cE69bE/+PVS8G2jWmv3dvPIskkDOpbIG8g9fxq94qAEmhkjH/E8tcjg929KqL98Ohx3gXj4iXS853XQ/wDHjV7xX47ujey2uiSLFBEdpuANzSEdcZ6CsPSJpLXxhrUsOfMjivyp9D81ZNjDDNeW8U8gSN5kVmPQKSASfwraqk5X8iIvQ9J8K+GPEGqWBvr7WJoFvFDoHkdnK9jgEYBrr5NG1VLS5jg1geewQQPJGXWPH3sqTzmsubxp4bs9Wupxqbs/kiBYliYxoFJIwQO5OPwq5Z+NtEurqGJbkbpYFkBYEAE5yDnoRj9a5nzFqxz/AIx8S634ZksY5INPmWZPnlRXALqfmGCeMgj161xfhy/l1j4l2V7OAr3F0W2g8KNpwPwGB+FX/iV4mXVtSlsrVo5LKHYUcD/loAdxB984/CuX8OmZfENubTPnhJPLx/e8t8VvSWj9GTJ6mt428RSa9qrLGdtlbMyQIDwecFz7nH5YrniSF464pFwFH0px4NSlYD2zwtoehzaFs05pmhmiMNyVuXxISMNkZwOc44FYXiL4ZQeWZNBuGWVRk2877gw9m6g/Xis/w346k0bRbeztdEV1jXMsomI8w5OWIxx6fhVmy+IrzX0f9oWogMrIjyRvlQuT1B6YyDn2PrUWkmVocnpEdz4Y8Wn7eix3FtbySbdwYZMRKjPTuKz2nluXaa4kaSVyWZ2OSSa2tcvIda8cX9xYfvENrIFyvUpEc/y4Nc6j4Ax3raetvQSNbRdLm1jUYrOBlQufmd+ij1/+tXp+heGLK20mWxlle9tLgrIVlAVeOQRj8+TXmGgtEdRj+03T2kGGEsyZyikEHH54/GvUrfxLoFhp9ukeqRyxphNqbi5GOpGOB/KsJXNInOePfDcFrp8OoacHEMRCSReYzKo6AgEnHp+Vc54V1VtG0fW7qBttzJ5UMJH8LEsSfwAP6Vv+JfG8Oo6VNp1nbSIjgJ5jEYKjHb8K5LTLOS40G/njGRb3EbOP9kqwz+BIq4/A7g1roZzFnJY5JJySTkk12nw+F47KltCq2yvIbqUcdQuwE/ngVx7ClWTEZjYZQnPXoeOfyFLcLHruoPpohkivJrWZAFMsbMG+UkgHH8q8r8Z6faaXq5gsJhJAyrIo3btmR93PfH9abb6TqFzAZ7GxkkgZiocYPI/GsW9yvDAhgTkHqDV0V76Im9DX8T8T6Yn93SrUfmmf61uaIoXTIeeoJ/WsHxWduqwp/csLRfx8lP8AGt3SzjT4AQeFrSp8KFHc5wVr+EzjxNpf/Xyn86x60/DTbPEOmt6XKfzrmexSO3+LGoTaXrOh31vsMkSy/K65VgdoKkdwQSKw73xxpd1ppt7XQVtbh+rxyBVBwR2GSME8VpfGlJJZNJ8uKRyBIMIpbsvpXndvpmoSH5NPvD6Yt3/woppOKFK92eh+CRN/al0hk81zvDsQctz14ORz71q+MJAW0Yhs41u0yfzrJ8A2V5b3oa6tp4V2Nkyq0YP48VoeLnydNZgFP9tWrAbwe56ewqkvfQuhyXhZUf4lXsMi7kea8Rh6glgay/E+gXOg3rRSgtauT5Ew6MPQ+hHpV3SLuDTviXdTXcqwxfbLpC7ngEswGT25r0ifWNDkRorm/wBPeNhgo8qMD9Rmta11JNLoTGzR5PHrsvnWplt7aSO2hWJIjGMHBJye5JJJPrWhHcajr5uYtO0uFmlIaVoIcbMA8A9Fz6d67Q3XgqFdv/EmA3bsBVPP5VcTxZ4ct7cJDf20UI6LEhCj8AKz97pEqy7nJSfDfVxbwSLPaGVgTLGXIEfoM45J/T3qhoekXOhfEXS7W8KGRZFfcjZUgo3/AOqu2k8c6ABj+0g30jc/0riNV8S2tx42t9YgSR7a32LyMFwAQSB+Pf0rSlGprddGKTiT+OvDLaXfG70+B2sJvm+UFhC3dT6DuPy7VyR+lepP8QdEVfl+2N9IcfzNU5PiFpQ+7Z3R/wC2aD+tSoVP5R3j3OU0PQNY1RWaxtnELfK00h2IfxPX8M1qa34IudO0ZbyOf7TcRkm4jjXhU9V7nHf/AOtWm/xKsyAFsLk46ZkQVWb4jKT+605sg/xTj/Cj2dXsNOJheAjjxdbMOySHj/cNdHrvgsyXLXOkeWqP8zW7nbtP+yfT27VyNrq01rrx1WytIoiXYi3UEpgjBHrXTR+NtXmfZHpcIyCQSrmqqU5tprsONjPi8La077fsW3BxuaRQP5101h4KtIkVr+4mlkI+ZYiEUe2ep/Ssr/hJ/E0obyLFeOu22Y4/Won1fxfKB8jRgn/n3Vf51k4Pq0apPsze8aWkVv4ZEFpbxxQwSo4VR93OQTnuTkdaofDSMmx1A7QytKqspGcjaeoqjLaeLNTtnhnnZ4XGGTeoDfXAos/B3iC1DGK4S2Dj5ikzLke+KFyqLTkiuSd78rNK88DCW6ZrO48mBjnY8ZYoPQHPI+tA8F6fAQbq+lfB5XKpmoovAmrXI3z6uBHn7zmRs/TnmtWz+HmixYa8luL5+5dti/kOfzNZynCP2r/IpUpy6BLd6bp8CwRXFrFFGMKiyLx+teb+NLiyuL8TWjq7uhMpU5G7sfrivUpPBfh3aVGkQD35z+eawdX+HelTqfsRltHI42sWX8Qf6GinXpxlfUc8LUa0OF8UzmTxBPgchIUH4RIK3LC4K2cQP90VT8R+F9Yt75rswrOr7S0sPIUgAZ29QOKdAxSFFB4AxWsqiklY5+RxdmjNq5pMy22qWdxISEimR2OOgBGaKKgk9mXxn4YXLNqKM2O0Tn+lRXnjvw00OyO6kY70bi2bswJ/lRRUKmkU3c8guNOgluJpTqy7XdmAFvIeCSe+Kk0+xsbW/tbqTUHfyZkkKraHnawOMlvaiiun207WuZ8iHatZ6ff6neXi3N0q3Fw8oTyF+UMxOPve9Vl0vTVXHm3pPsEH+NFFL29S1rj5Ikq2OmL1huH/AN6RR/JaelvpybgLWRkb+Brjj/0Giik6s31Dkj2GJaaev/Lnu/3p3/oRWdfvDbzhYrK3CkZG4u382oope1n3HyrsRNehhgWtonGPli/xJp32l3KgxwD/AHYVH9KKKlzl3HyrsaWi3scOrW7XSRNbB8OpjXGDxnpXq3/CO299BH9nWNI5BlyqgAD8OtFFZTk+500bK5BN4G0qOBVRHLLklzIQSax7PwjZz6yiNJMix/PhW+97Z7UUVi5NPc64pOLujutlvZ24ihVY1HQLWLKbiSZvKi8xR/FuwBRRWcjamrRuORrpHbLW8CgZOcsf6VatgWPmSRvKQOGlGFH0WiipHLYuicceZlh6AcUySdMYHA+lFFK5KiiEspGSykduaQKrjqD+NFFNFEUkJPGOKxrvw9Z3E7SPbruPUjIz+VFFUm1sRJJ7n//Z", "thumbBack": "data:image/jpeg;base64,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"}, {"id": "vin:1000000000002", "artist": "Queen", "album": "A Night at the Opera", "year": "1975", "genre": "Rock", "label": "Santa Records Ltd (1994)", "country": "UK", "tracks": [{"side": "A", "number": 1, "title": "Death on Two Legs (Dedicated to...)", "duration": null}, {"side": "A", "number": 2, "title": "Lazing on a Sunday Afternoon", "duration": null}, {"side": "A", "number": 3, "title": "I'm in Love with My Car", "duration": null}, {"side": "A", "number": 4, "title": "You're My Best Friend", "duration": null}, {"side": "A", "number": 5, "title": "'39", "duration": null}, {"side": "A", "number": 6, "title": "Sweet Lady", "duration": null}, {"side": "A", "number": 7, "title": "Seaside Rendezvous", "duration": null}, {"side": "B", "number": 1, "title": "The Prophet's Song", "duration": null}, {"side": "B", "number": 2, "title": "Love of My Life", "duration": null}, {"side": "B", "number": 3, "title": "Good Company", "duration": null}, {"side": "B", "number": 4, "title": "Bohemian Rhapsody", "duration": null}, {"side": "B", "number": 5, "title": "God Save the Queen", "duration": null}], "notes": "Издание 1994 г., Santa Records. Produced by Roy Thomas Baker and Queen. Executive Engineer Mike Stone.", "thumb": "data:image/jpeg;base64,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", "at": "2026-05-25T00:00:00.000Z", "price": {"low": 10, "median": 20, "high": 35, "currency": "USD", "note": "Издание Santa Records 1994. Оригинал 1975 UK — $15–45.", "url": "https://www.discogs.com/master/5863-Queen-A-Night-At-The-Opera"}, "thumbFront": "data:image/jpeg;base64,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", "thumbBack": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCADYANwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDtYFDJz6ipQVEkYx2f+YqO1+ZOvcUr/wDHxGPZv5iuJHSOuJ0jAMh2gnA46mq/2i3PWVB7E4/nU1wP3trn/nr/AOyNWX4i1ObT3iELL8yklD/FyKajcuMeZ2RoiSBukkR/4GKXy0YcYP0Nc7b+Jo2uEjvYoo0I+ZsZxUs+uaYzsI1hKL/y0KDn2AxzT5GW6M07WNxoAR939KYbNW/gH5VzP/CS2wVQlgS+fmPmFRjPbHtV5vE2mpEWRb3eOieYQD+OafKx+wmuhsNZIsZCKPwNVlsVkkO+IYHTIBrk28S6mHYx3TBSchWAOB6cilXxRqo6yxt9Yh/Sj2bK+rTOom0OymbdLbRsf9xf8KrzeGtNcf8AHnGvuoK/yNYqeLL9fvR27f8AASP61u+H9Xl1UT+bEkZjK/dJOc5/wptSRlOjKKu0U5PClgwwI5FPqsh/rVKXwRasPkuZ0+uD/hXYFaXbxyKOea6mNovocHL4Kk5CX/H+3Gf8arXHgmTYNjwOw67l6/pXZXOr2kF09vIsu9MAlUyORn1pF1Wyb+KRf96Jv8Kv97uTenseeT+DLpefssDf7r4/oKozeFLodLF/+ASA/wBa9UF/ZMR/pCj2II/mKcLmxl6TwMf98Uc9RdAtBnj7+Gblf+Xe5X/tmT/IVWk0OeLqsgHq0Z/wr2wQW78oqH3U0n2ZR03j8aXtpB7NHhTWhUkbwCOoIxTDbOOQVOPevbZ9Ntpc74o2z/eQGqkvh3TJcl7K3Of+mYH8qftvIXszx3S7GRrwPInyg56g9K6NFPcH8q7YeFdNjJ8q3Eef7rMP61BL4atsfI8q/wDAs/0qJTUmXGNkceOWJPAppJZumSeAMV1MmgJFFLIJ5CI0LkFQcgAn+lZTaRfXOim7022lFv5Yle6OMup6rnPy49B+NVCPMEpWMeaeG3OJCZZs4ESHv/tHt9Bz9K1bXw54qvIRPFm1jb7sRmMWB/uj+vNdb8P/AAxaW+mQag8KyXkpYh2GfLAOML6dOtaur+ItI0e8NpeSyGcKGYRoW257H0PfHvVOooPlgibN6yZoW77YeAByKUOXuE3ckZ/mKjt+RjPOelP2/vUP1/pXOaD7o5mtfQSMf/HGrD8Tanax2rwKiTyuCCQf9X9T/St66jLyQKmMkvjI4+6a4LxVFNFqZE+0OygkJ0q4nTh4KUlcx2+bnAGSTRkL1NIenAro/CmlrMrXdxFG6dEJOSCDzxWjdjunNU43ZzqLNIf3Mbt/uqTUR3KxVwyn0YYNdxoFjc215dl4tsZlJDeo7YqzqFtHLKftiQ7GIAQrlsHjdmjm1MHifesef/WgZro9X8NPApns3DRg4ZCeVrEe2liIEiEZ6GrTuXGcZK6JLGeCESi4txLvXCk87TXR+BxlLwgY+ZP5GqVj4cNzDHJLceXu6gLnFb/h7S20t7mJ5RJvKMGAxxg1Mnoc9ecXFpPU1+lKRStSGsjhOL1ua3h1a6M8gX5hj1PyisafXpc4t4kVR3fkml8Xn/iobv8A4D/6CKxTXs0aUXBN9jzqk3zNIszaleSk7riRQf4UO0VVWWRekjD8a3PD/hyXVleWR2ghHCvszvPtVmw8KLdSndehUO4oAnzFQcZPYc03VpQuuwKE5WZzG9wch2B9QalW+vYlzFd3C/SVv8a6O88E3calrW4jmx0VgVJ/pXNz2s9s7xzwujqcMGHQ1UZ06nwu4nGcNyaPXNWjPy6hcfi2f51bi8Ta1wq3RkPYGJST+lZIhkkzsjZsDPyr6U63x5igsUzwHH8Pvx2odKm/soFOfc9TsXaayt5ZPvvErNgY5IFS+Xu9h60mmgHTrUgjmFOg/wBkVYZTjGcY5rxJLVnpJ6FG8jSK0uHmXCCJ92R22mr9pf6frPh67TTJAyJaMpj2bCvyHHHpWZ4gbGkXgBz/AKPJ/wCgmuJ8OXE1neWU1uT822NlB+8G+Ug/XNCjfUGxf7e1B9GTT4bl4bcZyI/lJzzgnriruk+DtS161Oo/aU/eu3zSklnI6kn61hxARSsjLuCPjB74r2LQL7SbbRbNLa5hihMe5EllXcMkkg++cj8K0q+69CY67kNo7og2ADn72wZ/OpSDJKGbuTzUdmjJ/FwTyKsSEb1xjqawNBLs+VJEyqWKrIdo6n5RXmes3EtzfTSTqQ+4jBGCK9KuW/0uH/cf/wBlrkPF2kt819BgD/loo6/WqgdWHmoys+pyLHHXrWp4d1R7C9wzHyZeGXtnsaxyTQBWtjulFSVmdRpF615fz+dPIPMYhVDkACpNRhul1FHE+8RrhGzgKvfNcxDPLC2YnKn1FONxM7Zdyx9+aLGTpe9dHWX2qxJZS26v5ksx+YqeFrLiV5ypf5uc1kK5Zssea1tOnSORd+ce1XFIlw5FodlaWjvbxPIhBONoBOFFXFTFxIf9lf61paVe6dfaeoU7DEuME8j3rP05zO9yXbcBIFU4A4xSnDS55rbd7isDSEYFWXXFV39qxsSeY+Lf+Rhu/qv/AKCKzrO2e6uooUUkyMF4rR8V/wDIwXn+8P8A0EVn2M6217DM5YKjhiV617dO/slbsedK3O79z1DTbX7HapDkHb0AHAHoKraZpr2l3dSyMWEjfuzngLknGPXJq/bSrLbxyq4dXUMGHQj1rL0LUp9QlummBVAw8obeNpyRz64xXke81J/ed/u6I1JZkjA3HBbIUH+I4zj9Ko6hCGiF7DgSxLllPIdepU/0qXUIJLiIbXPyNvVF/jIHAJ9M81n67fw6ZpkkRkU3EylI0J5yRjJ9h60QV2rbim9Hc0rYwTIJY0QEjnC1574nsLW01h4rNjtYZKKudjn+EfXjjtmup0zVrK3syiXCzyxRF328jgV59NdT3JYzSFvMcyld2RuPU/XiuzC05KbfQ56004o9X0kZ0yz7fuE/9BFXpQotU4+dnbJ9uMVR0f8A5BloP+mCf+girjH7vtXBL4mdS2Rk+IYyNHvTjGLeQ9f9k1yvgOze+17TlVcpCVmkPYKvP88Cu016Bp9IvQnLG3cKPU4qfwVoSaBpBmuXj+0yqvnPn5Y1HRc/qTSvZDtdnJeGtCttT8Q6rBfBzDblzhG2ncZMDn8DXo9rFBYQLbWcKwwp91EHFeaab4mj0zxHq81raveRXsreUqNgk7iQRwcg5NbJvfG92fOhtrSzjb7sL7dwHvuyf89K1qQk3d6Ci0dJbMSvtn0zQSpnXac9c0y26Dig/wDHwvA79PrXOjQJz/p0X/XN/wCa1Hd2sN5A0NwgZGHIqWeASyLIJHR1BAKkdDj1HtUZgkH/AC9Sfiqn+lNDuc1d+DoXJMFw6855UEnPXPSsHU9CubCbaxzEwJSQggHHY9cGvQvLmB4uPzjFJsn7TJ+Mf/16tSNoYmcd3c8rkieMAuu3PTJpYoZJVZo0L7SM7eSK9Pe0MmfMjtXyDndEec9e9EdsYo/Lit7VUxjauVGPyp8xt9b02PMdrIxVlKkHkEdKnibBHNdxqeii6s54oLW3imkAxIrnqDnnjmuebwnqq/dNufpJ/wDWqlJGka8JLV2CwvRbjLSN055rqfC16s9tcsp/5agdfauRfwxrA/5Yow9pRXSeEtPudPs50vI/LdpcgZByMD0pyldGNfkcHZnQSSZqJm46UtIRxWRwnE65ZDUbu9RcJMkx2NjrwODXIXcE1tO0Nwu116j/AArt7m3uBq95I0UuwykqRGcEcc5qWa0srxAL23Dt2ZlYEfjXqU6vIkt0cUoczZyUPiDVILZbeK6PlKu0KVBwPTpVjS/FFxpsWz7NFM20KHYkNtHQcelbNz4f0mdMQt9mcDqr5B+oNY8/hS7V/wBxc2cqnuZgp/EGrUqE1ZqwrVFsOufGmpyqRGkMOe6gkj86524mluJmlnkaSRurMck1uXPhTUIkVlktJieojmGV/PFZF7ZXFjIEuYih7c8H8a1pKkvgsZz538RFDMYgQAeucqdp6evpT3uN8skvlqHbkYAAU9+MY+npUa7MHJGaacYIHpWtkRqewabn+zrUk5PkJ/6CKtqpNV9NH/EvtP8Arin/AKCKssdjcHFfPy+JnqrYp6u8v9l3awKDJ5L7M+uKo2/hTUNUiSTxLqskwwCLW3O1B/T8h+NaHiKeOHSLy5gwrrA52Nzk7TXJ6V461aK9hlv5FntTgSQrEq4U91xzkfWmuZLQNOpTkmi8J+OGWJWNtFgFW+ZvLdRnB9Rn9K9YgiWaGOWEh43UMjr0YHoa8g+IMkM/iaO7tn3wXNpFIjDjIwR/SqdrbM0CNPefZ8jKLJv5X1GOMZzV1I8yT8iYu10esQj5V4zzTYjulGABwen1oPEYxxgGorIj5f8Ad/qa50asuU1jQTzQBTEN5JpwGKxpIDqWsXcM086Q2yoESKQoMsuSTjqeanGjIPuX2oL9Llv6mnYVzTpRWaNKmX7uq6gPrID/ADFB0+9H3dYuf+BJGf8A2WgRpcUhNZv2PUx93Vs/71sh/wAKb9n1kdNQtm/3rX/BqYGmBS4rM262Ok1g31hYf+zUoOsj7yWDfQuP8aVguaGaM1nebq6n/jzsm+k7D/2WlFxqg+9pkJ/3br/FadguaI+tLz6n86zvtmoAc6Uf+A3Kn+lH9oXgxnSbj8JYz/WiwXNLn1phQHqoP1FUTqc68tpV7+Gw/wDs1UNY1ye3sfOhtpoGEqqxnQDg56cmizC5stDHj5o0P1QUxra3brbwn6xj/CuVTVNfvCk9lDE6bG2h8KWIxuAH8RGO1afhbVbjVbaZ7hVDI4UbRiqs0LQ0m0+yb71nbH6wr/hUL6Ppj/e0+1P/AGxWrqkOoZSCD0IpcUueS6hyrsNRVQKqAKqgAAdAKZPnbUmKSVeKQzD8SOTol6O32d//AEE157F91M/3RXoXifjQ732t5P5V59bQy3EsMNuhklkIREHUk9qqOxLHalGyDS5Z9xidHC/7okOR+pr3DTjp15Ywy2IhlttgWMpggAdvbHpXmfxF0saVaeHrcEMYrd42YdGbcCT+ZNbfg7wrpVzoFvdanbvJPcEyAiVlwucDgH0GfxqqlnCLHHRtG1KT5SgHHFNsvr2FEp4UHshp1l3+g/lWCLZaApe1A6Uh6UxGVYf8hzVfrF/6AK1gKy9OH/E51X/fi/8ARYrWApsQlRCUeZIpKgIAc59alNVSURroPkqqjI68GhATRSrLGjjjeuQD1p+Kp53RWRjAUFgQCOg2mp7d3kD7wvyuVG32oAWZiicDkkAc4xT9wLsueV6+2aiu/uIPWRe/vUcjrm5DkryAQe4xQBaHWg9ajibfO5VvlCjj3z1qVyEUsecDNABikJ44pN2U3e2aYkqOFwcFl3AHrigBSawvFwZrK2RCMtcDr06Gtp3ImjQJlXBO4HpiqWrRm80aZo4S8uwtEo5YN7e9UtxM5wazZJZpH9mlke3JaKRm+6/94Y6D/OKm8EOyfaIwqlXcMSDyCf6c1kBRFo/nyo6TK78tklcOAAQfqPyro/CGHsVk2IrOPMZlH3s/4EfqKt7CRs2+TbpnHTt061IaZbEfZosDA29KkNZlCCkbml7U0UAZ2vW6T6ZdRSP5ayQsC/pnvVPTH8IeFi039orcXijaHz5jKMc7QowKva1bx3WnzwzDKSRFGwcZBIFSWGjeE7C4jt0TTjcNwqyyiRyfxJ5ppxtqGvQ4nxz4ntPEIs47KOUJb7z5kgALZx0HpxVqLxn4ms7eC1h0mBI4IkRQ1q5JAUYPXuMGtn4oWiR6DbyxxIhjuAq4UDAKnj9BXT2UlprNnDexqLiN0AV9hOMdR7YOa1c4qC90mz5nqZ0pO489EqayHyk/T+VQTEYJ9ENWLLiM/WudGjLAp3WmjmnUCMzTv+Qvqx/6ax/+i1rUWszTiP7T1b189B/5DStIdabERXio3kh8HMgGM4pInLvcFh8vAGfpT7hS7Q/3Q4Y+5HSofOLPchAHC7cY75HNCATKMLMrgBiMD/gJpYWEURPXdMRyfU1GiKiWULkuQcqduAcKaRDlCTHKxE7cKARyetMC1cMqhGJHDDimTTFRMHj3KCoAzyadcMhMauCSWGCB05qObYqzEqWywJz0zjj6UASGcJJKX+VFA5NQyyvumJJEfl8ZGQakZGllkWTaYyBtx1pAGUzDbwqDGTwTzQBIyj7Md/I2c5qJfKNxGFBDCPPTgccVYlBMDBQMlcc/SoHARVjyNgixknkUICtGrKkJZWVEhOdnJJOKt2uPs6YBAxwCMfpUQlJMTDkGEkrke1PtmYwRlwA20Z+tMQl5Z21zGVuYEkBIJDDrg55/IflVTS3LafDcysgzGdxwFAGePar8p+Q/SuZu7u3tvDVgt2pZJgFA27hu6jIyOM00B0UbxsCImUhTghe3t7U6ud8PXdm9/JBbrtnaINKFjZF49ixHf2610VJqwAKaelOHWmv0NIZgeMH/AOKevQD/AMsGrzxkAQEKPrXfeMjt0G7H/TIj9RXCSScEDGGAB/SrjsS9zfudbl1TwVd2d7IZLmzlheN26vHnbye5BPX0IrJ03UdYtrUR6deXsMOclYHYLnv0703T7d57LVpF+5DZl24/20x/n2rqfB3jLSdI0OKyvbCV5UdjvjVSGBOcnPft+FaP+Hp3F1OklOFPPO01atP9X+NVJzhGx/dq1Zn90M9ea50aMtKKUnFNzUF3KY7eWRTyiMwz7CgDEOp2mm6nqMVxcKZ7iQukcfzMqiMct/d+6ap6fr97b6laaYlvbS2zbFWVX5APfIJGcdvWuQS+luNSn1FxHG7lg0kkm0NkbeBj09KnaG70uS3naJoWhPmxSOuQ5HPynoeD+ta8pFz1ndVCFoQLpIlKAcFgMZOP507Tp7maCNrmJVLKG3DgEEAjg8g+tWDChVlIyGOSKz2KILeNiLJwVKCMZBHI46iprWIxI4YYzIxHuM8H8qmUbQBknHqcmhqGwIZ32+WOhZwOmarvL/x8fd5YBdo3E8Cp5kLvGQThWBxTo4lQsR/EcmgAjJNxKMEKMAZ/GpZYw8TJyNwxkHFHHWlZqQEdwnmQmPcV46qcVA0ClgWORs2sM9en+FTMc0mMDmmhFSSFxIzIM/u9qjj1qa3DLAgfJYDBJ71JRmmA2Y4ic+xrCGmLq3hiygLBHWOOSNyMgMPX2rbuTiCQ+imqWkFl0G0MY+YWqlR77eKaAr6HoY024ubmSRXmmwBtGAijsPxrXNCZ2Lu+9gZ+tITSeoBSNyKBQ3ApDOf8YW8s+i3EdvG0kjoAqqMkncK4y38P61eA+Rpd2wBwSYyoH4nFd34hv/sFnJcGJpFiCMVXqfnFVP8AhYMhVgmiXkhPOS3/ANjWkYza91Cdr6li20B9I8BapbzhPtc8DyTbecYHyrn2x+ZNeZQwyyJmKKRxnqqk12ur+NNQudNuok0aa3WVCjSybiEB4P8ACBXDx3EkS7UkdBnOFbFbQpT5Gn3IlJX0PX5RlCM5+WrVoB5K+tVVG48cjirdvxEtchqTE1U1M4066J7Qv/KrI5pJ4knheKQZR1KsPUGmhHlclrC2mYSUi4aXMXGQyEEHJ7fl9ael5O9nDYTsJRC5ZASNwXAABPfABH41248J6OGJFu4Jz/y09aWPwnoyOrrancpyDv71pzImzJNMOrW+lWsf2SKSQA58yfZtXPyjoe1WvO1jtY2n/gUf/ia0FAAAHQU4VFxmZ52tf8+dmP8At5P/AMTR5us55tbP/wACD/8AE1qH7pJ6ComcngcUAZ/mayT/AMe1l+Nw3/xFOEms/wDPtZf9/wBv/iKvjPc0vakBnGXWf+fayH/bw3/xFNMusk8W9lj/AK7t/wDE1ok0oFAGbv1n/n3sf+/7f/EUjSawOkFj/wB/2/8Aia0mIAqJnpgZ5l1j/n3sf+/7f/EUCXWf+fax/wDAhv8A4irm7NPBoAzZ/wC2po2jENjHvGN/nM233xtGfpV6G2EFjHbK7YjiEYboeBjNSlgO9RtJ70AOB2Iq5JwMZPU0BqiBzT+KBki0khwBSrUNy3AA78UgMjWb+OztJLqZGeOMoxCdThh0rNX4gTRuQ2mp5bDOBOc/yqbxYinRboSEqh2AkDJHzCuJvdonCoSQsaqCRjPA7VcYprUltpnrGja5Z+I7SUW+5XCFJYJTyAePoR715LZanPpyPBFFAw3kkyRBjnp/SrXhzWH0TWbe7U5j3BJl/vISM/4/hWXqYEepXcY5CzuAfUbjXRh4J3RM3sevQ5LrySOKuwf6hPpVO1PI+lXLcZhXPpXIaEPnztLIkKRYjwCXYgkkZ7Cgy3Q/ht/++m/wpsXy3Nyf9pf/AEEVi6l4ntLdnSAG4deuzhQfrW0Kbm7RRnKairtmtcXs1vGXkEAHTjcSaqf22+QB5XP+wx59ODXNz+KLydWRYYUVvYsR+fFY8l9dk7muJMqMDBxgenFdcMI38RzyxC6HeS61PFnLW4/4C3+NZV94sv4OYI7aQDr8rcfrXHGWQ8tI7H6mhWZzgE5Jxj1reOEgt9TN15PY7G38WzzqFlkijYngCPj9TWnHqN0/KzxsOvEQUAeuScn8q85lBWQqcgit/wAOec8jDftUc7ipJP05A7d6mrhoRXMhwrSbszfudT1OE/NcIF+8u234K+xPetbRbuW802OedtzszDOAOAxA6fSsW+tEe23Kq7jyZHYsSfT2H0rV0HculwBhhvmyMdDuNcdVR5NEdEObm1NQUpYcVFuNMZiTxXKb2PPrzxTqy3MyJcqFV2AHlL0z9Krt4n1j/n7H/ftf8Kzbsf6TMfWRv5mq5rSx7CpU7fCjXPifWP8An8P/AH7X/ClPijWcf8fh/wC/a/4VjZLYwM09oiHCEgH3anYfsqf8qNT/AISbWW4+2Nn/AHF/wp41/WQ2JL0r9UX/AArHVQjDzWwvfbyTT7i5M0mVRUUDAA9KLE+zhfSKNy217VJGcfb2O3GCsQYn8MUsHiDWDdCFrljuYbd0aqcZ57elYKOxj2CUqAchOnPrViyk82+tvNZmIdQD+IxRYHShroj1nOM1DINxXPalLcn60DLVmeQJAFW5hLYx5sfX61wfxCtLi28VXT3JBNxtlQgYypGB/Ku11CMSxwJv2H7RGc7Qehz0PBHFYviTwlJqV8t1p9zFGrRhfKmLfKQMcHnj27VUdBM87SJ7idIYlLSSMEUDuScCrPiO2Frr+oW46Rzsor0Twr4MXR7xb/UJ47i4QExJGDtQ/wB7J6n0rh/HQ8vxZqOBwzq35qK6cNK82l2ImrI9JtGPJ/2D/I1fgOIhmsy3OFb/AHK0Yj+6FcZoc74tu2htLiOJmVpZUBI4+UICea4sqSd/HPrXS+L5cXIQHoQxHb7oFc1uyTgfLnOK9jCq1NHnV3eZPDDz83AI4Pqam0zS5tTvPKjyFUEu/YVCMtzjI+tdP4TeWK2mdgBACTuPbHWnWqOEG0KnBSkkzD0SGJbvy7kAkFkeNh0I4/xrRu9Mt7YrdxBSqSAgHpwc4rohZWF6q3gtkbzRuEoG0sPrQNJtoG4idRsxsZsqfeuWWK96+qOlUNLHnuoW0iXJcDIkbK4OQc+ldF4esL9c7ZY1RgN2HyR+FbL6Xb/ZzEEBQHIWmazFGmlu7nY6AbXBwQfrTliedKKFGhy+8y4tjujVZXLYAGOw+lWLFRHbBR0DMP8Ax41Rsbm9u4LYQQfO6rukmO1QfX1NaFtDJBbKssiSMGYF04DHJziuOd0rM6I26Dyc9O9NYgHApe2e9Rlgp9azNLHlNy2J5Oern+dQN2qzKFMrn1NNjRGlUOrFc8heprQ9noQjcAMY/DtTvIdpEi27Wc9D1rqtK02dwHSFLeMHIDLkn8aq6bp19/ahnlhIKucOTgKc8nHfjpTuYustfIv23hmAxRfamaTauNh4FWLrwxp0tsUii8mQD5XUk8+/rWu8qRhN7AbmCj3Jqq18ou5IWIAXYF92bP8AhU3Zw+1qN3ucgulwEywSh4riM4bByPr9Kp2ULRarbxvjImQZH+8K3vELLDqEcwIG9CjnH5Vi6e4m1izA/wCeyAn15qjthKUo3Z6YPmJqZeMY7VEhxzUgbJrM8szPEUF7PbRjSpFjumuI9jMQB156g1lTXHjW0fBsYrlEyPlVWJ/75INaHiTVW0a3hu1iExW4QBC2Ac571zv/AAsHVBdGQW9msOeISpIH/As5/GtISaWyYnuXD431O0AXU9CkTb1I3p/MH+dcZ4h1FdY1WW9EZiDhQF3Z4AA5P4V6X4e8Z2usz/ZJImtrojiNm3I/+6fX2Ncn8Q9Jjj8QB7OMRLNAsjqgwC2SCcfgK3oTgp/DZkzTtudjCx2Pxj5a0o/uVlxH5G/3RWojDbXGWcb4vhc3hmwShwhPvtBrnUyMYHevSGgiumu4p0DozLkH/dFYuo+GQIy9i2T3R+/0NejQxMVFQkcdWi23JHOlVKj+natjTL2G2sWtbwmGORvvOOxxn9O9VJtNu4Id7RsQOpTkj6iqcrPcWyo2SYR8pxztz0P0rWSVRWuZxbgztdKltIrRIrSWJ0Ax8hGPyq40ybSGcAD1PSvLvnB4bHuOKELLJvSRgwOc5PWsXg7u/MbLEWVrHpyuJOY8MO3PBoaCJf310Vdl6FxhU+g/r1rhYdUv2kEZvZEB4HOBXTWsE7Qokl2HJ5wTk/8A16wnQdPdm0aqnsjViu7dtzCeMhBliG+6PU061k8y1jIOVO4r+LGm2drb5zco7EAYGO+fXin2a/6NGRjGD0+prnlZLQ2SbY9uuBTXGEY+gqQKScmmzcRvn0qLlWPLCOufWpLOSOG7jeRcqpzxUBbnGaZI+3p9719K2PXaurHfW2p2kigJIu7GcCsObxFcy6m0Fo0KQglQ0i53EVzMZkDblcrz1zSl9hJVsE9cHrRZHOsNFNtnV30uqS25jmNvDjkSoTk/4VitezJO80s6tJ8uV29SvAI/Cs671K4nRUeQ7QMfWoFzgdSTTsOFK2jLN9fTX0oaZiQPuqOgqXQ/+QxZD/pstUwp5IBwOpq/4eXzNcsR280UGsrKDSPSotz9M4qwsRPenRIFAFSuOBWVzxznfF+mz39jBDbxec32lGMe/aXABJAPrgVyniqweGOOU+H73TPLRUcv80Z9Dux1PSu+1XUI9MNtdTxSyRRz5kMa7ig2nLH2Hem/ESWPUPB8j296kaxhZnjLYMoI+QYPPUginFsTR44JWjdJImKyIwZWHUEcivToynimys9SVUEnk+XMufuuGbI+nOfxryt3AOK7bwLZ39zpMz2jYjFww79dq1o+5KZ08J/dt9K00bK4rHhcFH/3f61fjfjANZlBHcRRXNyssiIdykbmAz8oqb7XbnpMh+hzSAE9Rz+tSZKEIcl26LTumKzG/aYs/K2fop/wqJrWzuSQ1sjHu3lH+eKmdyo5BA7luKeb6zit2VriFHbGA0i5/nVJ22C1ylqPh21ltyTb5JXPmRJ8y+5HpXKp4bvxIf3eQDw2QM++K7VdbtY4kc3cKvE3BMg+6az7vxNo7TsVuYE5ztViQK0WIlBaC9gpPVGFb+GbxbhHmRdgOSNwzW5bae9uxKRvtPYzn+WCKiXxNpJ/5fY/1/wqT/hJ9IUc3in6KT/Ss6lec9zSGHjHY1IxMFAEUXvlz/QVJDH5cKRkjKjBxWR/wlekKCTOxAGSRG1NsvF2mX92ltaLcNK/3Q0W0N9Ca5232NlA3wAFye1QS7TG2TwQRVp7d2hG51jB7L8xrLu7XdkCWRse9Z86NFSbOYk8O6dG3z3Uxx6bf8KryaRpKEndcN9XA/pWhf6fc7Wa3fJ7B8gfnXG6pqOoWMu26ttoJ4bcSp/GtozcgqTqx3ZsvZacRxHMfrIaj+wWJYYgOfdzXO/8JDPnhE/I/wCNKPEd0hJUR8/7Of61epi6s31Ori0zThy9ohP+0Sf61bSz0xellCSf9nOa4lvEt6RwVH0QVG3ia+Q7gwz0Hyiiz7k+0l3Z6NBpmn9Ws7cn02DAq9a2tlDIrxWkCOpyrLGAQfrXlqeLtSB4kx+Apx8X6qvImP6f4U7MTm+57GkyjqaWW5GQAe1eNN401knJuD+f/wBakHjPVyw3zMR3w2DRyMi6PWry7SKezMrqqtNj5iMHKkY5qDxDothq+nRWUn+jfZsmBo0B2A9sH+H2BFef21/pfiQC31jWZ7J8fu2nTegbPtx+NaR0DxjocP2jRbtNXsMZ3Wr+cuPdDyPwpqHnqF/IbB8OL6W8Cz6jbLahuXQMXK+ykYz+Nel6Vb2+k2EVlp/7u3iGFGeT6knuT615zpfxCWGUw6xYyQyKcM0WTg+6nkV00Xi/QpIw66nAoPZyVI/AilOFTqgTj0OGk19IyCupPL6rHERn25Ap/wDwmM0cYWGacnqS0EfX2PJx+NFFaEmbc+Lbuacxm4ugW5IRwg/Srmi3rXhkU+YzqQRukJ60UUm9CoL3hLyG9uZvs9napJJn06fjUUWiamGKyLChHI46miisHNo7VSi1c1vD2n6jfySW92nlxJj9+AOR6D3roLvSdMs4QhgBIH3mOSaKKzlJtm1OCSMkwaYmSiLn0CZqaKMSIPJsOP78gCD9aKKTbK5VcvafpEM7iSdBO2eBtxGP8fqa6MafZMqtLHEHXG0DjbRRUSbY7IsGdVXEbKB/vVA1wjnG8fQUUVNhoo3L87g1YurRRXMDJNGkinqCKKK0iiZHnOr2AsZiYiTEx4z1HtWeOeaKK6VsefNJS0FGOp6CoJG3NmiimQxFqbOR70UUxDHQrjNRnjrRRVJ6CZbtIcDew5PQVqabd3WmzCfTrqa1lH8ULlfzHQ/jRRUNlJHXp40t9SiSDxdoVrqaqMG5jASb6/8A6iKrmx+HdyfNS91mxB/5YNFv2/Q4PH40UU4ya2YpRR//2Q=="}, {"id": "vin:1000000000003", "artist": "Stevie Wonder", "album": "Greatest Hits", "year": null, "genre": "Soul / R&B", "label": "Balkanton (BTA 11920)", "country": "Bulgaria", "tracks": [{"side": "A", "number": 1, "title": "Love Light in Flight", "duration": null}, {"side": "A", "number": 2, "title": "Go Home", "duration": null}, {"side": "A", "number": 3, "title": "I Just Called to Say I Love You", "duration": null}, {"side": "A", "number": 4, "title": "The Woman in Red", "duration": null}, {"side": "A", "number": 5, "title": "Never in Your Sun", "duration": null}, {"side": "B", "number": 1, "title": "Pain", "duration": null}, {"side": "B", "number": 2, "title": "Boogie on Reggae Woman", "duration": null}, {"side": "B", "number": 3, "title": "Whereabouts", "duration": null}, {"side": "B", "number": 4, "title": "Don't Drive Drunk", "duration": null}, {"side": "B", "number": 5, "title": "Overjoyed", "duration": null}], "notes": "Болгарское издание. Made in Bulgaria. Manufactured under license.", "thumb": "data:image/jpeg;base64,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", "at": "2026-05-25T00:00:00.000Z", "price": {"low": 5, "median": 10, "high": 18, "currency": "USD", "note": "Болгарское издание Balkanton. Редкое для своего региона.", "url": "https://www.discogs.com/release/13687883-Stevie-Wonder-Greatest-Hits"}, "thumbFront": "data:image/jpeg;base64,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", "thumbBack": "data:image/jpeg;base64,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"}, {"id": "vin:1000000000004", "artist": "Queen", "album": "The Game", "year": "1980", "genre": "Rock", "label": "EMI (EMA 795)", "country": "UK", "tracks": [{"side": "A", "number": 1, "title": "Play the Game", "duration": null}, {"side": "A", "number": 2, "title": "Dragon Attack", "duration": null}, {"side": "A", "number": 3, "title": "Another One Bites the Dust", "duration": null}, {"side": "A", "number": 4, "title": "Need Your Loving Tonight", "duration": null}, {"side": "A", "number": 5, "title": "Crazy Little Thing Called Love", "duration": null}, {"side": "B", "number": 1, "title": "Rock It (Prime Jive)", "duration": null}, {"side": "B", "number": 2, "title": "Don't Try Suicide", "duration": null}, {"side": "B", "number": 3, "title": "Sail Away Sweet Sister", "duration": null}, {"side": "B", "number": 4, "title": "Coming Soon", "duration": null}, {"side": "B", "number": 5, "title": "Save Me", "duration": null}], "notes": "Produced by Queen. Engineered and co-produced by Mack. 1980.", "thumb": "data:image/jpeg;base64,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", "at": "2026-05-25T00:00:00.000Z", "price": {"low": 10, "median": 22, "high": 45, "currency": "USD", "note": "UK оригинал EMI 1980. Версия с фольгированной обложкой дороже.", "url": "https://www.discogs.com/master/13248-Queen-The-Game"}, "thumbFront": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5Ojf/2wBDAQoKCg0MDRoPDxo3JR8lNzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzf/wAARCADYANwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0JwwOSpGaiZsZwfrUOpO0iWe0ZH2jLMCMKADwf89qgmZZ1M07bLROx43e59q8jBV5V6XPJWdzrtqI95A0m0O0nr5alqEvLYHa/mR89ZIyBVyEL5YMOAhGRt4qC0kaS4ukkbcqNgKcHFdQ0otbFkLHIoYEMpHDDnNCIAOMVTnia0JntAdo5kh7MPUehq0jrNGsiHKsMqaBOPVFbUdTstNMf22UxmQHbhSc4+lUv+En0gji5f8ACJv8KxPiCWM9guTgRv8AzFcwijH3vetYwTVzNyszvm8U6T/z2k/CE03/AISbS8ZEsv8A36NcIRtfCnpTnBUA1XIieZncHxRpSjmaXP8A1yNMfxRpRI/ey9M/6o1wsgJOSOtJIucY9PWnyIOZndf8JTpX/PWb/v0afH4l02RsK8xOP+eRrz3GDW1ocKzmWUkgQpuYgZxT5EJyZ2cesWkoCxiViRkLs5P055os9bsGkJJlAAPBTBrmRcRucSknJySKz50DSkxkjJPeq5ETzs6ybxJpyyFf33H/AEz/APr0HxJYKgOJ8f8AXP8A+vXILA0h+Ugt1xmtjSNNl1HzrSK1LyhNwLuE2Y7+9Hs0HOzQbxPp2fu3H/fsf41PF4jsbiFlkMqqg+VnTkZ7DnmuNubWWGYxyKVYdc0wIyrznaT17Go5UiuY62XxJp8Z2yLP7fu//r0z/hJtPxkGdh6GPn+dc1LBI8Y3KAFTIOeCPaq9xatFFFKvKSDr6EdRS5UO7OrHifS36NNn0MVKPEum/wB6b/v1XFMFYfNw3qKArYGDn3o5UO7O4XxFprDgzf8Afv8A+vSQ+INPMwCvKh67nTAH61xqgqM5ods4NLlQXPQoNSsL+2EqTKrA8hjgn8KVZIscSKfxFefwtzwcH3qXznHAbFJxHc9G1dzPHbxxxSKFuAxJTaMEEfzNGqGKLTZvNJESrhsYzjI9am1M7bcOAflkVz9Bx/Wq2sMP7MmYAkFR93GcZHSuXD0IUIKENi3tcElI1CziVnCtAW27uOncetIsrIuouqojJIMMq4Lc9T61LCVGoQRlMubcEPk9PT0oZpDbXpI8zEuFV/mB59K2ZVMvoN0SMw5KgmqdjiNZ4R0jlIX6HmrLPtRVGBhecduKp2PzrJN/z1csPp0pCvozlfH8h+2WYH/PJv8A0IVyyMQO9dN49/5CFmP+mLf+hVzYA3DNbx2MXuKrEmrMQ3kAiooLaW4fbEmeMk+grVigFvahZM+YTuQkdOOaYjVtikOmO6iBZMZUyoCG9qxZ9WuWBBjtVHtCKrTzySbUyxA6CmCJ5Y2OPw70JA2J/aE/P+q5/wCmYpY9SuEikhVgFk+9hQM1Xa2lDfcP5UCB88rz6d6oVyzDKX+6cH+76/SrMYZnUryScAiobG0MrruO1c9a0lhkhcPEp2Zx8w61aIY2TNu6tEpWVPv5GOfTFdPpV3bX8MdxaN9n1OA/MhPEg9R/hVFLGSSFblo2IY/OT3qnqmjXWmeXdwEtbyjdHInY+h96p3SJVmaPi+xVovtEaqCGGV7g965pph9h+zlQSH3K3cetaNxrMtxEFust33d/xqitsZopLmNhtUgMvce9ZM0QqWk4subd+TkMVqvF5JgmWdirBcxgDgtnv+FdlFMv2aN5GCgoCSx9q5PVEt2kmkhkQ4bhQDkjvUJ3LsZUsfGRUanB5qcHNQygdqYiRSCCKjY7eCKhWQq386ll5AakVYkTPBUVFJI28545p9sryuqRqWLdgK14vDtzIu5wqknoTRcdj0KfDjYwypBBHrWbgRobO8ZhC3+rl9s9D71ozdRSxRCVSrqGU9QRkGsS0+jLFumFXByoAwaqQCSEXJkyu6UspJ/hpz2MMSnyZJovZJDj9arGxiZsyvLLj++5IpFe6la415Gu2MMB/d/8tJe30FXVQIgVRhVGAKI1VFAVQAOgAxTmOBTJb6I4jx2M6jae0B/9CrmDncM9M11HjrJv7bHaA/8AoRrmmOOveto7GT3Ox0uGKDTokA2vKgLNj61n6zv3qjTbwOAFGAP8a0bFxeaZGUd1OzYx965+YSJKFZmwD0PSktxnSW9la2Nil0Yw7YDEsecY6D0NV/D65nYsilGX04HPFSC/t5dHZXw2F+4TWcNanjtVjgSGNf4doxijUDqSqMdwC5HTisjWdG+1g3sDAORkjp0rOtdRuJAxEnzcnGK1NDhbU3e1ecfMpMak9W9KuMGQ5I52zcpPlx068V6D4fW2k0uSOdAyychvQ155fBrO4kidWDIxDAjvXR+Gb/fb+XvGQeAWq46ES1O10uyiWGSESefATym77v4Uy700Q2csK4ktznGTytck+tXum6mzxHCtxjGRit221x9RgZJwnK5yODVX1I5TkdX0oQndGpIz0HQ1mefPDG0TK8cL437U61savffKY0IC5yCRzXPy3UhGzzQQO2azkaxLF3NZGNTHJNJxyCcGs1ZQpPGR6Zpkjrgkj8qj5OPepLRcjjSfYkRw/cHvwTULwl1BGc554quGx0NWYbgkhC+FBz9DSHYqXEZXOM8evemxOSOe3WusubKwuLV5rZwWAyVPUj+hrl7i3EEmUOUP+eaLjNnw7dWlpODMCHYECQ8ha65JomUMsiEH/arzyIYAJGQDnGcZrQtfN8ofMRSaKTPR361Pa8R59arSHLYHWrLfJEAPSsxEcr7mOOlIB1pAKeOmKAFHSmOetKTTW70gOL8dOVv7f3gP/oVcuzEnr3rpfH4zqNp/1wP/AKFXLDIJ4raOxm9ztfDMi/2YgDDLSEMPSrGoWMcyNtHJICnODXERTyREFGIIOQQa2LfxDdKQZCH5yOO9JrW47kN5DJbEqD8pH+RVDJ2mMehP0rXvb+O7jBUbHxgqFwKyjHH5pZskAHIzVITF0+6mhmWZATtYc9voa7WQRg22r6WhEb8yInWF+4x+o9q5nRZxbXYWKESLJ8rRkZDCut02/tor5FtIR5EuVlKjgemapTsS43K/iOxXV4Tf23M23Lg9T71xdtLcQ3KxoGLA/dAr06/mtLGBsMEODtUdTXESPHDeJdx8SM2Y0YZ+rH27D/61NSvqK1tDevbSFNNVpS4mPBJ6A9xWL9omgdnhmjVcYbnr+FTX2pQ/2E6xyFg8hG12yy9wf0Irn7O7aNtmPlbr7/WkmxtE17eySPyRj2rOlfcemD61sRXELKzGCMjGcKuMf1FI9slz/qcZI6Nz+RFFxpGIdxGCaljJyM9am8swuyvCdwPQ9qmiEeNzIfwFSykUWBqM7wc1amKnorflUKHLDj86CiayvXhfdnoOnrW9b2EmsQmTbHEFHyDbjefXNc2IWzlVz754ruvDwlTT4RKoXjjmpegI5iaxmtdyTRlWFXrW3cwIQO3rXQ6uAbUhtoYg7CRxnFczLfGArGygsFGcnvQtRnoSrmUU+VsmmIfmLGmocnPrUCJBSk4BpO1Nc8UAITSnpTFGeakIwDSA4jx7xqFoev7k/wDoVc0BkYIrpvHuPttnn/ni3/oVc529q2jsQ9xqoDmpooB3pIk3OAO9X2i2IAe9AiAgBAB1qKQbVJJx2NW44tzgE8Eir2pWSWkaKpyZMq4IwT7j2/wouMh0eWwg3yzTsswUhAUOBkda19Cu7drZo03DYfvMDls96s6Vp1oLONhEhYrkkjPNTaWJDv8AMUqoAHIxmpbGkZfiKR4QjsC4z9w/56VzMk80k7yyH5m5OO3+Feilog3lnB3A8EZBqpJp1hKzRzWsROOqjBx+FNSE4nn0cTzu2CPlUsST0FJ5eGBDqR7Gusl0S2tZ/MULJDn5kb7wFaSeHrP/AJ5J6jgU+ZBynAMrI4w/P1pPtDrnaSM9ea9AfQbUMD9mT/vmnR6HZBv9RFn020uZFcp56ssx4Uydc4UmtCO3uLhBtmnORyhBFdrJpKIq+QscZ3At8ucr6VYS0iVRjH5UnIaRxNtod1PgNFt93bNbdh4YgjKtMdx7itz5EYADHvTkf5h70uZjscZq9haadqkLS5aBvnK4yeD0q9Z+I7aSVo5VMY6qRyPpWJ4lunn1SQN0jOxR7CspCwf09qq10I6vUNVM4+YAKOMeo9awJXLSMT696YXZlVSSQKkkXc2QCc1UdBs9XEYMJ2vx1LFeKro2LkxAgqIwwb1ySP6VPdupjCMrAZA2ggYquoA1BgOnkL3z3NYJjsWVPFMf0pwODSP0pkgvTFKelNBwak2ErkYwTxQBxPjz/j8s/wDrk3/oVc5uWuk8e/8AH5Zcf8sm/wDQhXNY459a1jsQ9y1p6F5fb8quycuBxxUelMqtuKg4HepQpds980mBc0m1Mt0gI+XOan8RSNbyLIHXDDYiFOijr196t6KnlxySHqKi1BBqtu8ZA3A/KRxipvqPoPsrhILEiOQSNs3Lz145FYsXiK/JcF0YH+8vTNZhs9TglKQq/wArYAUg1Lb2V9In+oADdT61VkK5Ym1O7Dxv5gbaOwxUMut3Ulx5glKsB1FakOiRtAVkkYSgfeXoKwdR02azm+cbl/vDoaFYZuabrZeZElVXJOGZz/Kuk/tayg+SS5jwOOvb0wK83SOQsCgIBOMnoM1bjiUrksBgE8n0OKTSGjtZvEdkn+r8xwPbAqje+LYlB8qAMe241zMqiOPcWB3dBWcxJY5NJJDOjfxfej+CHHoVp0Xi64biSCM54ypIrlzjAyRQMAct+lVZBc66PxVA7qJonUAYJ681ft9dtJWXbKODznjiuCO3sx/KnKAwPPQUcqC5JfzfabyaXs7kj86iX73FIO9TALhdrZJ6jFMBw4AB9fStGJMxjiqZik2hgrBT3IrXhtnMakgiokzWCPQrgxhAhaT5mzjFViNupMMEYgXg9fvGrU4QkhpVyW6kciqbkHUsKdwFuOf+BGs1uR0ZYo6jmgUVZA+CMSBhjnI5IJqaHIiICsQS3cDFRsCGKLblgD/tc0+Fcj5lTgnAKkmoZSOI8erm7sT/ANMm/mK5ZmxwK6vx7jz7Ln/lm38xXKFRux2reOxm9y/pz4c4x93HPerKBlPy1n2rBZAGPHtV9HXIC4NJgjotGIFnKWOOec060RnBZNoDcAjvVXRJgfMi3DJGRVidzYpsAUM5yBioKM5rC4W9LOQQDnOa1gqlVAAPYdqa+n6jK3meZDHk52kbvzpy6dclRJ9pjd+4CkDNO4FG7vhYwvJL91QcAHBJrl4dafz5GuV8yKY/Mh7fStnxXpl/IyNHCxgTrtOcH1Nc0lk88qxgbecZIqlYRq2qxahM6WW5UCeYY3IzkdcVJq9gLGzVwhy0hDEnPOBwPbOea1rXwx9mtBLZzmSf7wwcBxjpn8axNZg1BpVE6zH5AFRhyAPYUuozJ8wnBLZxTJG+c+9NKlDhgR6g02UgsCKoBM5p3G0etNApwA2+9ADo4ncZVSR61JFbscE4AI7mo1dgOCacrsT1oAsRwwJJiRyyhsHHGRVh5LZFjEEYLJ95iOtZ2c96mijLAkA49QKRRo3GoTTRrG7fKOgwOKsy3ZiYKc5xWX0IGKvuhkYseecVLSLTZ6PctNxjPXkBarMu3Uhxgm3BIHY7qvTSBVIZpCR1IOKgMSD97nczDAY9dvU5/GoW5Aop2M00c07tVEDt7NJncygn+8eKdGcSlfLfk9Cx49Sajx0p5kkKFS7EemaTQ0zivHv/AB9WP/XJ/wCYrmCDwa6X4gttu7D/AK5P/wChCuaDZHUVtHYh7kgGRuB+oqdGIwRVYfL34p8MoBxnLdvekxo6HwrH5t/lsAIu41ta7GjRmbB/dqWz27CuW0fUPsl4r5ADfK2emK6G6NwYJZLoKE24ClgAcHr71DWpVzZt7hZbaJyOHQfqKpWsq2xf7Rcx85wrMBiuej8QfZ7VIlwdoxmufa7FzLJJNkuzEk5/Smoiud3d6vaqMJMr84OGzjNZM1lb3167WzqgGOnc1ycsoCgoD7Y9agjv7uFmMUzxk8nacU+ULnqlkkGnWiJNOgABOXbGa57Xtf04r5VuhnfOQ2doU+oPWuNikmvJf3txyRnfIxNOWB5JxCpaR84UKOTRyhcuXN/NeSAFI2kOOVj+ZqpT28wflMY45IqVljiU7kfPu+P6VWMiDpEv4k0wHCF/QfmKVYnLY+UH3IqEt3wKlWdRjEKD6Z/xpgOEbJ1RW/HNM/i9PanmWN+TGQe/z0pKDkq3/fX/ANakMvaTZw30whaTy3PTJ4NdfBo1rb2xTBYnjd6Vw9tL5civHuVlOQc9K7GPWYJNPEhfkABh33elTK5SOe1GEQzlR61ciHy8+prJnmaaUtnvn9a00dduPSpkaQPR8xuPnQ5I5weDVQxsbsSgAIItgXPvmrCk5pjDDUWMbiqPXFOFNHFPpiEopO9OoA4X4jnF5YD/AKZP/wChCuVRjmuo+JP/AB/WH/XFv/Qq5NDWkdiXuWieBTMkMCKjDdqU5boDTEWYvnYnnAGSSOlaGnJc6k/2WaV/KHC7udn0qjdKbS1ihJIllAkk9h/CP6/jWppsNxcxsbU7HSMGQjsPX60mMx5rN0mkiEoIRiM460sVrFuwZicdeO9as1k0FsZ2cMpGVIPesQRsWO0kkZJwKANu38uFFVOFXk/WtA6FbaxYeZaBUu0++ucBveuctZ0imR7hWlhB+ZA2CR7Giz1a5srky20jKMnAJzx6UrMZDd2E9hcmGdCjA96aC45HBHRlNaXiLVEv5IblXcMUHBHT1HvzWMbgs2XJYfWmgFYnPOeneonbdgEKMegxUhnQ5+Xv60ySSL+6c560wGjlaUdqI2BzilHIP1pDHKT2NPG52+Y9e5puVDAjjGMZoDHoDxQMnYqB8oOeh54oDEHjvTYkL8ZAzxknpSmJl+9xUjQ9CemBg85xzWskkJz5yZYHgj0pfDemQXu9piw29AMV0cmj2YIwjdP71RJmkUdGh+anOOgqNDzU5GQDVGBEOlOpMYo9aQw704U0dKcKAOB+JJ/4mNgP+mDf+hVyag966r4lNjUrDt+4b/0KuUVjWsdiHuSgcV0PhJLeaWaKe0SZdm8yMeUA9PqcVzYOMYNbmmTG203YpIku5QCf+ma/4n+VDBEesQySXMt03zK79R2PpWv4OR3a7bJCmPBrBuZ3+2NErnaSQQD612Xhaza3tJNwx5h7+lS9ilucxfXUNpqSpdRtJBnLrG2CwrL+3eVfG408vCQ2U5yV9vetLW9Hu/7RcSKGEjZDRndtGeKxZ7SW1lMcq4Ydx0PuDTVhF9y91KwMaxu3LLjaM/0pg0+5dWaOCVgG2kqhIB9M1a0u+VoDb3wzBGpIkGN6j0Hrz2rU0/TLq8kia2ujLYPINxjcjaf9pfWi9h2Odk0y92bmgcKMnkY+tMXSrsrIdgAQAsSegPf6V6fqiQxQBoQiyxj5M57dAa41tbkjVojb8xjcpAztHfkdv/1dKSdx2MQ6ReBzGYzkOF/Poc9waLnR7uB41lXG/pWrH4qlhRUigjMY42uMgD0Ht6elEOsXep3EgMSEK3nAIOVIAAx3IH+NO7A50xMjYbscGkwVOK37rRp2huLsMCkfJYjl/UgdgM1hyEYGO3GaLgNHNSRgZG7OPamKMjNSAYHGTSGSJjIwSPetW0sJJU86bbHEuBudwOP51lRRs5wtaNtZZ2szgE9u9JlI1dHvLe0mfz5UVWGF2gnFdCmpWzKNswI+hribsQmY7GOOh+taFlsWHG7v/QVnLuaR7HfRn5qtJ0AqmhwasqeBVnOKw46VGelS9aay0DGjmndqQcUooA89+Jh/4mliP+mB/wDQq5VBwK6n4nD/AImdj/17n/0KuUXgDNaR2Ie5LxjGasfaTGyMv/LNcKKq9aQ89KYHSeD7W2u70zXDM0kfzCPbkN7k13ikSjCDbXL/AA/tB5FxORyWCD+ZrV1vfYWks8MxUn8efYVnLVlrYm1GwjuzsGATjd74rHj8PxpMsfmASNyoJxn6H/GneGdRluJJpZj94jr0q1eyK2pxyNcxx7E5Rj157UaoDJm0+0juydYSTyowQpWPBb0yRVTR9RsNIvZ5Y3d1kBVIgSNo9SeldJd3VtPvQyRklRwSCD+Nc3d6HaysQpMTEblKngg+1C8wDW9fS9g8to5F+YYG7gev1rnL25We4dotyR4CKB/dAxz+VF9ZzWkpSY5H8LA5BHtVYNiqQD4LdppFSPlmOADxV20e60y8WZFw8Z57g+3FMsJI450eaNpEB5RTgn8at3k0RIRWYumQT2PPA/DpQwNnWwt1pcd8lw4yijyg2NuT0x+dcq0fJHvWl50s1ikXHloxxgc/jUIiOOai9i7E8Wku2lrdg9+QOwqpLAY5dgZWHZlPBrZsL3ybF7WSMsrcgg9KzxAFAY9c9KLjsQwkibC8E8VqqPItmkbO7HFQIkTXe+NDGh5CFt2Pxp99KJHEan5V60mwSM7axJJrQtHGxs/3v6Cq5T5W+lXYLC42bgAAxyMnHFJ6lx0Z36nLcdKsq2aqZ5AHTNWk+7mqOckBp/tUamng0DEYYpKd2oI5pAed/E7jU7A/9O7f+hVyStxXX/E1T/aNgf8Apg3/AKFXJBea1jsQ9wz9aORyacoHpQwyaYG/4R1saddtDcNi3kU59m7GtvxZqEclv5UUgJ4YrntXB8LmpWu3aJInO5EPHqKTWtx3NG21f7KCIwRmlh1COeadrlAyvg7u649KzMRSBju24PfvTEI5HY9aLAXJpkGWjyKfb6pKbkPK38O3J9Ko8YPIpACTiiwzW1KW2uIVWFy8p5bjAWsFjgkZzUzqwGOcVGItwbkfSkMmtZRGwdl3YztHqfX6ClVXLdDUC8Y3A8cCtC1v/IjKLBGw77/m/L0oGia1H7oqDz3qUKc4xUMLJO42v5ZJ53dBVycNbME3RzHGd8ZyKhmiFQBeTUM8yIPmbGOg9aheWV2AwVHc4qpJHmTLOFGepPP5Uhlnzt8x8rOO2euKmA7dSetU0dIifLYE+pFSrKxPDjPptxSBFliMFf1qw1/PFhBIcAcZGcVn+aQfmAPuK0Ut4plDuDnHY0XsUlc79hhutWYz8vPNRumWz2qVVxiqucwoOO1PFRgc09aQx9KD69KbmjNAHBfExf8AT7Aj/ng3/oVceQQBiuv+JjEX2nEf88X/APQhXKBkfG7g/pW0diHuRDIPNLnHSpmhLfN0BPrTGiK57gelMCJzkVETUzLzgdajEZOfakAAkDPH41safFpuDHrFvdxblBjntyPlz/eU9f51jsvGBQksyZCs3PXnrSauMluYljZ/KfzEBOGxjP4Vc0KGK8v44ZlLBsgLu27jjjmqKh3Bz3HNOgElrMkySbXQgg0DN7XtEXSlQrMkjOMlM8j6D0+tYBQjLAHHQ8d63JNSt79Qbhdr4wSOi/QDqfc1QUoJB5cZIz91+R+NSUVIfKIfzg2cfIAOCc96kNqjDdFJtz2atCHT4S4yTgAZycD3P0qfyogx8qMYzxxUuSNIwZkpbzIeNpHs1O8mTA46ehrTZR3p6KmPWoczRQRkGKTurGmGB8/dNbMhTb1/WqbuO1LmG4lSIeU5Lrmpx9mfgsFpSGI4Vj+BquyOG/1b/wDfJqkyGrEsq+UwG8OpGQa0LFz9nXmqEAXzE+0hgnsMEVbuhBbSCOOQldoOTRa44vU9R4IHel9aKKDAAOM05RxRRQAU7rRRQBm6voFhrEkT30cjNECqFJCuAeT0qj/whOh/88rgf9tzRRTuwshR4L0cdBdD/tt/9anDwZo+MZuh/wBtR/hRRRzMLIG8E6Q2Mtc8dP3g/wAKY/gPR8/fu/p5o/wooo5mFkJ/wgejd2u/+/o/wpR4E0UH/l6P/bX/AOtRRS5mOyHf8IVoiD5vtGPeb/61MbwdoO/lZz9ZzRRUuTLjFMB4S0IfdikJ/wCuzVZi8L6Oh3Lakn3lY/1oorNzl3NowiS/2FpQ+X7Kpye7t/jUsej6bGrKtpCAwwevIooqLsuwg0rS1ORZW/8A3xmnrZWK/csoPwiFFFK7GOaCJRxbQL/2zFU7mWOIkAIP91RRRRcViJLxvKwYHPXB21BJcSn7ylfoCKKKSmy+RWK8kgmbYhZmPYGsmbwbc61cz3MN7Giq/lkMp6gDpj60UVbm46owaR//2Q==", "thumbBack": "data:image/jpeg;base64,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"}];

async function smartCropToB64(file, targetPx = 320) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch {
    bitmap = await new Promise((res, rej) => {
      const img = new Image();
      const u = URL.createObjectURL(file);
      const t = setTimeout(() => { URL.revokeObjectURL(u); rej(); }, 10000);
      img.onload = () => { clearTimeout(t); URL.revokeObjectURL(u); res(img); };
      img.onerror = () => { clearTimeout(t); URL.revokeObjectURL(u); rej(); };
      img.src = u;
    });
  }
  const { width: W, height: H } = bitmap;
  const scale = Math.min(1, 800 / Math.max(W, H));
  const sw = Math.round(W * scale), sh = Math.round(H * scale);
  const cv = document.createElement("canvas");
  cv.width = sw; cv.height = sh;
  const ctx = cv.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;

  // Helper: avg color of a rect
  const avgColor = (x0, y0, x1, y1) => {
    let r=0,g=0,b=0,n=0;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
      const i=(y*sw+x)*4; r+=d[i];g+=d[i+1];b+=d[i+2];n++;
    }
    return n ? [r/n,g/n,b/n] : [0,0,0];
  };
  const colorDist = (a, b) => Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);
  const rowAvg = (r, cx, hw) => avgColor(Math.max(0,cx-hw), r, Math.min(sw,cx+hw), r+1);

  const bdr = 4; const cx = sw>>1; const strip = sw/5|0;
  const bgTop = avgColor(cx-strip/2|0, 0, cx+strip/2|0, bdr);
  const bgBot = avgColor(cx-strip/2|0, sh-bdr, cx+strip/2|0, sh);

  // Scan top→down
  let top = sh>>3;
  for(let r=0; r<sh>>1; r++){
    if(colorDist(rowAvg(r,cx,strip>>1), bgTop) > 45){ top = Math.max(0,r-3); break; }
  }
  // Scan bottom→up
  let bot = sh*7>>3;
  for(let r=sh-1; r>sh>>1; r--){
    if(colorDist(rowAvg(r,cx,strip>>1), bgBot) > 45){ bot = Math.min(sh-1,r+3); break; }
  }

  // Left/right: center-of-gravity of vertical edges
  const smooth = (arr, k=15) => {
    const out = new Float32Array(arr.length);
    for(let i=0;i<arr.length;i++){
      let s=0,n=0; for(let j=Math.max(0,i-k);j<Math.min(arr.length,i+k);j++){s+=arr[j];n++;} out[i]=s/n;
    }
    return out;
  };
  const vSum = new Float32Array(sw);
  for(let y=1;y<sh;y++) for(let x=1;x<sw;x++){
    const i=(y*sw+x)*4; const p=(y*sw+x-1)*4;
    vSum[x] += Math.abs(d[i]-d[p])+Math.abs(d[i+1]-d[p+1])+Math.abs(d[i+2]-d[p+2]);
  }
  const vSmooth = smooth(vSum);
  const mv = sw/12|0;
  let wxSum=0, wSum=0;
  for(let x=mv;x<sw-mv;x++){ wxSum+=x*vSmooth[x]; wSum+=vSmooth[x]; }
  const cxV = wSum>0 ? wxSum/wSum|0 : sw>>1;
  const albumW = (bot-top)*1.02|0;
  let left = Math.max(0, cxV - albumW/2|0);
  let right = Math.min(sw-1, cxV + albumW/2|0);
  const vMax = Math.max(...vSmooth.slice(mv,sw-mv));
  const vThr = vMax * 0.22;
  const vL = mv + vSmooth.slice(mv).findIndex(v=>v>vThr);
  const vR = sw-mv - [...vSmooth.slice(mv,sw-mv)].reverse().findIndex(v=>v>vThr) - 1;
  left = Math.max(left, vL - (sw/40|0));
  right = Math.min(right, vR + (sw/40|0));

  const pad = Math.max(4, Math.min(sw,sh)/50|0);
  const ox=Math.round(Math.max(0,left-pad)/scale), oy=Math.round(Math.max(0,top-pad)/scale);
  const ow=Math.min(Math.round((right-left+pad*2)/scale), W-ox);
  const oh=Math.min(Math.round((bot-top+pad*2)/scale), H-oy);

  const out = document.createElement("canvas");
  const s2 = Math.min(1, targetPx/Math.max(ow,oh));
  out.width = Math.round(ow*s2); out.height = Math.round(oh*s2);
  out.getContext("2d").drawImage(bitmap, ox, oy, ow, oh, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.82);
}

async function prepareForAPI(file, maxW = 1024) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch {
    bitmap = await new Promise((res, rej) => {
      const img = new Image();
      const u = URL.createObjectURL(file);
      const t = setTimeout(() => { URL.revokeObjectURL(u); rej(); }, 10000);
      img.onload = () => { clearTimeout(t); URL.revokeObjectURL(u); res(img); };
      img.onerror = () => { clearTimeout(t); URL.revokeObjectURL(u); rej(new Error("load")); };
      img.src = u;
    });
  }
  const { width: W, height: H } = bitmap;
  const s = Math.min(1, maxW / Math.max(W, H));
  const cv = document.createElement("canvas");
  cv.width = Math.round(W*s); cv.height = Math.round(H*s);
  cv.getContext("2d").drawImage(bitmap, 0, 0, cv.width, cv.height);
  const b64 = cv.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { b64, type: "image/jpeg" };
}

async function callClaude(frontFile, backFile) {
  const [front, back] = await Promise.all([prepareForAPI(frontFile), prepareForAPI(backFile)]);
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: front.type, data: front.b64 } },
          { type: "image", source: { type: "base64", media_type: back.type, data: back.b64 } },
          { type: "text", text: `FRONT and BACK covers of a vinyl record. Return ONLY valid JSON, no markdown:
{"artist":"string","album":"string","year":"string or null","genre":"string or null","label":"string or null","country":"string or null","tracks":[{"side":"A","number":1,"title":"string","duration":"3:45 or null"}],"notes":"string or null"}
Include ALL tracks from the back cover.` }
        ]
      }]
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`API error: ${r.status} — ${t.slice(0, 150)}`);
  }
  const d = await r.json();
  const txt = d.content?.find(b => b.type === "text")?.text || "{}";
  return JSON.parse(txt.replace(/```[a-z]*/gi, "").replace(/```/g, "").trim());
}

async function fetchPrice(artist, album, label, year) {
  try {
    const q = [artist, album, label, year].filter(Boolean).join(" ") + " vinyl price Discogs";
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: 'Find the vinyl record "' + album + '" by "' + artist + '"' +
            (label ? ' label: ' + label : '') + (year ? ' ' + year : '') +
            '. Search Discogs for current market price in USD. Return ONLY valid JSON: {"low":5,"median":15,"high":30,"currency":"USD","url":"https://discogs.com/..."}'
        }]
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    const txt = d.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
    const match = txt.replace(/```[a-z]*/gi,"").replace(/```/g,"").match(/\{[^{}]+\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    return (p.low && p.high) ? p : null;
  } catch { return null; }
}

function exportToExcel(records) {
  const wb = XLSX.utils.book_new();

  // ── Лист 1: Альбомы ───────────────────────────────────────────────────
  const albumRows = records.map(r => ({
    "Исполнитель":   r.artist || "",
    "Альбом":        r.album  || "",
    "Год":           r.year   || "",
    "Жанр":          r.genre  || "",
    "Лейбл":         r.label  || "",
    "Страна":        r.country || "",
    "Состояние":     r.condition || "",
    "Треков":        r.tracks?.length || 0,
    "Цена мин ($)":  r.price?.low    || "",
    "Медиана ($)":   r.price ? Math.round((r.price.low + r.price.high) / 2) : "",
    "Цена макс ($)": r.price?.high   || "",
    "Discogs":       r.price?.url    || "",
  }));
  const ws1 = XLSX.utils.json_to_sheet(albumRows);
  ws1["!cols"] = [20,30,6,16,20,12,10,8,12,12,12,40].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, "Альбомы");

  // ── Лист 2: Треки ─────────────────────────────────────────────────────
  const trackRows = [];
  records.forEach(r => {
    (r.tracks || []).forEach(t => {
      trackRows.push({
        "Исполнитель":  r.artist || "",
        "Альбом":       r.album  || "",
        "Год":          r.year   || "",
        "Жанр":         r.genre  || "",
        "Сторона":      t.side   || "",
        "№":            t.number || "",
        "Название трека": t.title || "",
        "Длительность": t.duration || "",
      });
    });
  });
  const ws2 = XLSX.utils.json_to_sheet(trackRows.length ? trackRows : [{ "Треки": "Нет данных" }]);
  ws2["!cols"] = [20,30,6,16,8,4,40,10].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, "Треки");

  XLSX.writeFile(wb, "vinyl-catalog.xlsx");
}

function exportJSON(records) {
  const data = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    totalAlbums: records.length,
    albums: records,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vinyl-archive-backup-" + new Date().toISOString().slice(0,10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJSON(file, onImported) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const albums = data.albums || (Array.isArray(data) ? data : []);
        if (!albums.length) { reject(new Error("Файл не содержит альбомов")); return; }
        let imported = 0;
        for (const rec of albums) {
          if (!rec.id) rec.id = "vin:" + Date.now() + "_" + imported;
          try {
            await window.storage.set(rec.id, JSON.stringify(rec));
            onImported(rec);
            imported++;
          } catch {}
        }
        resolve(imported);
      } catch (e) { reject(new Error("Неверный формат файла")); }
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsText(file);
  });
}



function adjPrice(price, condition) {
  if (!price) return null;
  const mult = condFor(condition).mult;
  return {
    ...price,
    low:    Math.round(price.low    * mult),
    median: Math.round((price.low + price.high) / 2 * mult),
    high:   Math.round(price.high   * mult),
  };
}

// ── ConditionBadge ─────────────────────────────────────────────────────────
function ConditionBadge({ condition, small }) {
  if (!condition) return null;
  const c = condFor(condition);
  return (
    <span style={{
      background: c.bg, color: c.color, border: `1px solid ${c.color}44`,
      borderRadius: 4, padding: small ? "1px 5px" : "2px 7px",
      fontSize: small ? 9 : 10, fontWeight: "bold", letterSpacing: "0.05em",
      flexShrink: 0,
    }}>{c.label}</span>
  );
}

// ── UploadZone ─────────────────────────────────────────────────────────────
function UploadZone({ label, state, inputRef, onPick }) {
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: "bold" }}>{label}</div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onPick(f); }}
        style={{ aspectRatio: "1", background: drag ? C.card : C.surface, border: `2px dashed ${state ? C.accent : drag ? "#d99232" : C.border}`, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", position: "relative" }}>
        {state?.preview ? (
          <>
            <img src={state.preview} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0a0806" }} />
            <div style={{ position: "absolute", bottom: 6, right: 6, background: "rgba(0,0,0,0.7)", borderRadius: 6, padding: "2px 7px", fontSize: 10, color: "#fff" }}>✓</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 32, color: C.faint, marginBottom: 6 }}>+</div>
            <div style={{ fontSize: 12, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>Нажмите или<br />перетащите</div>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) onPick(f); }} />
    </div>
  );
}

// ── FilterBar ──────────────────────────────────────────────────────────────
function FilterBar({ records, filters, setFilters, sort, setSort }) {
  const genres = [...new Set(records.map(r => r.genre).filter(Boolean))].sort();
  const decades = [...new Set(records.map(r => r.year ? Math.floor(+r.year / 10) * 10 : null).filter(Boolean))].sort();

  const toggle = (key, val) => setFilters(f => ({
    ...f,
    [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val]
  }));

  const chipStyle = (active) => ({
    padding: "4px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer",
    border: `1px solid ${active ? C.accent : C.border}`,
    background: active ? C.accent : "transparent",
    color: active ? C.bg : C.muted, flexShrink: 0,
  });

  const hasActive = filters.genres.length || filters.decades.length || filters.condition;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Sort */}
        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ padding: "4px 10px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, color: C.muted, fontSize: 11, cursor: "pointer", outline: "none" }}>
          <option value="artist">А–Я</option>
          <option value="date">По дате</option>
          <option value="priceAsc">Цена ↑</option>
          <option value="priceDesc">Цена ↓</option>
        </select>

        <div style={{ width: 1, height: 16, background: C.border }} />

        {/* Genres */}
        {genres.map(g => (
          <button key={g} onClick={() => toggle("genres", g)} style={chipStyle(filters.genres.includes(g))}>{g}</button>
        ))}

        {/* Decades */}
        {decades.map(d => (
          <button key={d} onClick={() => toggle("decades", d)} style={chipStyle(filters.decades.includes(d))}>{d}е</button>
        ))}

        {/* Condition */}
        {CONDITIONS.map(c => (
          <button key={c.key} onClick={() => setFilters(f => ({ ...f, condition: f.condition === c.key ? null : c.key }))}
            style={{ ...chipStyle(filters.condition === c.key), borderColor: filters.condition === c.key ? c.color : C.border, background: filters.condition === c.key ? c.bg : "transparent", color: filters.condition === c.key ? c.color : C.muted }}>
            {c.label}
          </button>
        ))}

        {hasActive && (
          <button onClick={() => setFilters({ genres: [], decades: [], condition: null })}
            style={{ padding: "4px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer", border: `1px solid ${C.danger}`, background: "transparent", color: C.dangerText }}>
            × Сбросить
          </button>
        )}
      </div>
    </div>
  );
}

// ── CollectionValue ────────────────────────────────────────────────────────
function CollectionValue({ records }) {
  const priced = records.filter(r => r.price);
  if (!priced.length) return null;
  const adjList = priced.map(r => adjPrice(r.price, r.condition));
  const low    = adjList.reduce((s, p) => s + p.low, 0);
  const high   = adjList.reduce((s, p) => s + p.high, 0);
  const median = Math.round((low + high) / 2);
  const missing = records.length - priced.length;
  return (
    <div style={{ marginTop: 14, marginBottom: 14, padding: "14px 18px", background: "linear-gradient(135deg,#1e1a10 0%,#252018 100%)", border: `1px solid #4a3a1a`, borderRadius: 12, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 50, opacity: 0.06 }}>♪</div>
      <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 7, fontFamily: C.fMono }}>Оценочная стоимость коллекции</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 28, fontFamily: C.fDisplay, fontStyle: "italic", color: "#7ab870" }}>${low.toLocaleString()}–${high.toLocaleString()}</span>
        <span style={{ fontSize: 11, color: "#8a7454" }}>USD</span>
      </div>
      <div style={{ fontSize: 10, color: "#8a7454" }}>
        Медиана: <span style={{ color: "#f0e2c0", fontWeight: "bold" }}>${median.toLocaleString()}</span>
        {" · "}оценено {priced.length} из {records.length}
        {missing > 0 && <span style={{ color: "#6a5a44" }}> ({missing} без цены)</span>}
      </div>
      <div style={{ fontSize: 9, color: "#5a4a34", marginTop: 4 }}>По данным Discogs · с учётом состояния · цены ориентировочные</div>
    </div>
  );
}


// ── AlbumCard ──────────────────────────────────────────────────────────────
function AlbumCard({ record, onClick, feature = false }) {
  const [hov, setHov] = useState(false);
  const p = record.price ? adjPrice(record.price, record.condition) : null;

  if (feature) return (
    <div onClick={() => onClick(record)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: C.card, border: `1px solid ${hov ? C.accent : C.border}`, borderRadius: 16, overflow: "hidden", cursor: "pointer", display: "flex",
        transition: "transform 0.25s cubic-bezier(.34,1.56,.64,1), box-shadow 0.25s, border-color 0.15s",
        transform: hov ? "translateY(-3px)" : "none", boxShadow: hov ? `0 8px 32px ${C.accent}22` : "none" }}>
      <div style={{ width: 180, minHeight: 160, flexShrink: 0, background: C.surface, position: "relative" }}>
        {(record.thumb || record.thumbFront)
          ? <img src={record.thumb || record.thumbFront} alt={record.album}
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "#060e18", transition: "transform 0.3s ease", transform: hov ? "scale(1.04)" : "scale(1)" }} />
          : <div style={{ width: "100%", minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center" }}><LogoMark size={72} /></div>}
        {record.condition && <div style={{ position: "absolute", top: 8, right: 8 }}><ConditionBadge condition={record.condition} /></div>}
      </div>
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
        <div style={{ fontSize: 9, color: C.accent2, fontFamily: C.fMono, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>Последнее добавленное</div>
        <div style={{ fontSize: 22, fontFamily: C.fDisplay, fontStyle: "italic", color: C.text, lineHeight: 1.2, marginBottom: 6 }}>{record.album}</div>
        <div style={{ fontSize: 13, color: C.accent, fontFamily: C.fMono, letterSpacing: "0.04em", marginBottom: 4 }}>{record.artist}</div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.fMono }}>{[record.year, record.genre, record.label].filter(Boolean).join(" · ")}</div>
        {p && <div style={{ marginTop: 10, fontSize: 14, color: "#6dbf6d", fontFamily: C.fMono, fontWeight: "bold" }}>${p.low}–${p.high}</div>}
      </div>
    </div>
  );

  return (
    <div onClick={() => onClick(record)}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: C.card, border: `1px solid ${hov ? C.accent : C.border}`, borderRadius: 12, overflow: "hidden", cursor: "pointer",
        transition: "transform 0.2s cubic-bezier(.34,1.56,.64,1), border-color 0.15s",
        transform: hov ? "translateY(-3px) rotate(0.4deg)" : "none" }}>
      <div style={{ aspectRatio: "1", background: C.surface, overflow: "hidden", position: "relative" }}>
        {(record.thumb || record.thumbFront)
          ? <img src={record.thumb || record.thumbFront} alt={record.album}
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "#060e18", transition: "transform 0.3s ease", transform: hov ? "scale(1.04)" : "scale(1)" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><LogoMark size={48} /></div>}
        {record.condition && <div style={{ position: "absolute", top: 7, right: 7 }}><ConditionBadge condition={record.condition} small /></div>}
      </div>
      <div style={{ padding: "10px 12px 12px" }}>
        <div style={{ fontSize: 12, fontFamily: C.fDisplay, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>{record.album}</div>
        <div style={{ fontSize: 10, color: C.accent, fontFamily: C.fMono, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.04em" }}>{record.artist}</div>
        <div style={{ fontSize: 9, color: C.muted, marginTop: 3, fontFamily: C.fMono }}>{[record.year, record.genre].filter(Boolean).join(" · ") || " "}</div>
        {p && <div style={{ marginTop: 5, fontSize: 10, color: "#6dbf6d", fontFamily: C.fMono }}>${p.low}–${p.high}</div>}
      </div>
    </div>
  );
}

// ── TrackList ──────────────────────────────────────────────────────────────
function TrackList({ tracks }) {
  if (!tracks?.length) return <div style={{ color: C.muted, fontSize: 13, fontStyle: "italic" }}>Треки не распознаны</div>;
  const sides = [...new Set(tracks.map(t => t.side).filter(Boolean))];
  const renderTrack = (t, i) => (
    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 13 }}>
      <div style={{ display: "flex", gap: 14 }}>
        <span style={{ color: C.muted, minWidth: 18, textAlign: "right" }}>{t.number || i+1}</span>
        <span style={{ color: C.text }}>{t.title}</span>
      </div>
      {t.duration && <span style={{ color: C.muted, marginLeft: 10, fontSize: 12, flexShrink: 0 }}>{t.duration}</span>}
    </div>
  );
  if (sides.length > 0) return (
    <div>{sides.map(side => (
      <div key={side} style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: C.accent, fontWeight: "bold", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.border}` }}>
          Сторона {side} · {tracks.filter(t => t.side === side).length} трека
        </div>
        {tracks.filter(t => t.side === side).map(renderTrack)}
      </div>
    ))}</div>
  );
  return <div>{tracks.map(renderTrack)}</div>;
}

// ── PriceBlock ─────────────────────────────────────────────────────────────
function PriceBlock({ record, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const p = record.price ? adjPrice(record.price, record.condition) : null;

  const refresh = async () => {
    setLoading(true);
    const price = await fetchPrice(record.artist, record.album, record.label, record.year);
    if (price && onUpdate) onUpdate({ ...record, price });
    setLoading(false);
  };

  if (!p) return (
    <div style={{ marginBottom: 18 }}>
      <button onClick={refresh} disabled={loading}
        style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${C.border}`, color: loading ? C.muted : C.accent, borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 12 }}>
        {loading ? "Ищу цену..." : "♪ Найти цену на Discogs"}
      </button>
    </div>
  );

  return (
    <div style={{ marginBottom: 18, padding: "12px 14px", background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Примерная стоимость · Discogs</div>
        <button onClick={refresh} disabled={loading} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, padding: 0 }}>{loading ? "…" : "↻"}</button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: "bold", color: "#7ab870" }}>${p.low}–${p.high}</span>
        <span style={{ fontSize: 11, color: C.muted }}>USD</span>
        {record.condition && <ConditionBadge condition={record.condition} small />}
      </div>
      {record.price.note && <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>{record.price.note}</div>}
      {record.price.url && <a href={record.price.url} style={{ fontSize: 11, color: C.accent, textDecoration: "none", marginTop: 4, display: "inline-block" }}>Открыть на Discogs →</a>}
    </div>
  );
}

// ── Lightbox ───────────────────────────────────────────────────────────────
function Lightbox({ images, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex || 0);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button onClick={onClose} style={{ position: "fixed", top: 16, right: 20, background: "none", border: "none", color: "#fff", fontSize: 28, cursor: "pointer", zIndex: 1001, lineHeight: 1 }}>×</button>
      {images.length > 1 && idx > 0 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => i-1); }}
          style={{ position: "fixed", left: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 24, cursor: "pointer", borderRadius: 6, padding: "8px 14px", zIndex: 1001 }}>‹</button>
      )}
      <img onClick={e => e.stopPropagation()} src={images[idx]} alt="cover"
        style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 4 }} />
      {images.length > 1 && idx < images.length-1 && (
        <button onClick={e => { e.stopPropagation(); setIdx(i => i+1); }}
          style={{ position: "fixed", right: 16, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 24, cursor: "pointer", borderRadius: 6, padding: "8px 14px", zIndex: 1001 }}>›</button>
      )}
      {images.length > 1 && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
          {images.map((_, i) => <div key={i} onClick={e => { e.stopPropagation(); setIdx(i); }} style={{ width: 8, height: 8, borderRadius: "50%", background: i === idx ? "#fff" : "rgba(255,255,255,0.3)", cursor: "pointer" }} />)}
        </div>
      )}
    </div>
  );
}

// ── DetailView ─────────────────────────────────────────────────────────────
function DetailView({ record, onBack, onDelete, onUpdate }) {
  const [lightbox, setLightbox] = useState(null);
  const [reshooting, setReshooting] = useState(false);
  const [newFront, setNewFront] = useState(null);
  const [newBack, setNewBack]   = useState(null);
  const [reprocessing, setReprocessing] = useState(false);
  const frontRef = useRef(); const backRef = useRef();

  const images = [record.thumbFront||record.thumb, record.thumbBack].filter(Boolean);
  const [coverIdx, setCoverIdx] = useState(0);

  const setCondition = (key) => {
    const updated = { ...record, condition: record.condition === key ? null : key };
    onUpdate(updated);
  };

  const pickReshoot = (file, side) => {
    if (!file?.type.startsWith("image/")) return;
    const preview = URL.createObjectURL(file);
    if (side === "front") setNewFront({ file, preview });
    else setNewBack({ file, preview });
  };

  const applyReshoot = async () => {
    if (!newFront && !newBack) return;
    setReprocessing(true);
    try {
      const updated = { ...record };
      if (newFront) {
        const t = await smartCropToB64(newFront.file);
        updated.thumbFront = t; updated.thumb = t;
        URL.revokeObjectURL(newFront.preview);
      }
      if (newBack) {
        const t = await smartCropToB64(newBack.file);
        updated.thumbBack = t;
        URL.revokeObjectURL(newBack.preview);
      }
      onUpdate(updated);
      setNewFront(null); setNewBack(null); setReshooting(false);
    } catch {}
    setReprocessing(false);
  };

  return (
    <div>
      {lightbox !== null && <Lightbox images={images} startIndex={lightbox} onClose={() => setLightbox(null)} />}
      <button onClick={onBack} style={{ marginBottom: 20, padding: "7px 16px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>← Назад</button>
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 28, alignItems: "start" }}>
        {/* Cover */}
        <div>
          {images.length > 1 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              {images.map((img, i) => (
                <div key={i} onClick={() => setCoverIdx(i)}
                  style={{ borderRadius: 8, overflow: "hidden", border: `2px solid ${coverIdx===i ? C.accent : C.border}`, cursor: "pointer", aspectRatio: "1", background: C.surface }}>
                  <img src={img} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0a0806" }} />
                </div>
              ))}
            </div>
          )}
          <div onClick={() => setLightbox(coverIdx)} style={{ borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}`, background: C.surface, cursor: "zoom-in" }}>
            <img src={images[coverIdx] || images[0]} style={{ width: "100%", objectFit: "contain", background: "#0a0806", display: "block" }} />
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: C.muted, textAlign: "center" }}>Нажмите для полноэкранного просмотра</div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button onClick={() => setReshooting(!reshooting)}
              style={{ flex: 1, padding: "7px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11 }}>
              ↺ Переснять
            </button>
            <button onClick={() => onDelete(record)}
              style={{ flex: 1, padding: "7px", background: "transparent", border: `1px solid ${C.danger}`, color: C.dangerText, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11 }}>
              Удалить
            </button>
            <button onClick={() => onUpdate({ ...record, is_public: !record.is_public })}
              style={{ flex: 1, padding: "7px", background: "transparent", border: `1px solid ${record.is_public ? C.accent : C.border}`, color: record.is_public ? C.accent : C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11 }}>
              {record.is_public ? "🌐" : "🔒"}
            </button>
          </div>

          {/* Reshoot panel */}
          {reshooting && (
            <div style={{ marginTop: 10, padding: "12px", background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Загрузите новые фото:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <UploadZone label="Перед" state={newFront} inputRef={frontRef} onPick={f => pickReshoot(f, "front")} />
                <UploadZone label="Зад"   state={newBack}  inputRef={backRef}  onPick={f => pickReshoot(f, "back")} />
              </div>
              <button onClick={applyReshoot} disabled={(!newFront && !newBack) || reprocessing}
                style={{ width: "100%", padding: "8px", background: (newFront||newBack)&&!reprocessing ? C.accent : C.border, color: (newFront||newBack)&&!reprocessing ? C.bg : C.muted, border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: "bold" }}>
                {reprocessing ? "Обрабатываю..." : "Сохранить фото"}
              </button>
            </div>
          )}
        </div>

        {/* Info */}
        <div>
          <div style={{ fontSize: 24, fontWeight: "bold", color: C.text, lineHeight: 1.25, marginBottom: 6 }}>{record.album}</div>
          <div style={{ fontSize: 17, color: C.accent, marginBottom: 12 }}>{record.artist}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {[record.year, record.genre, record.label, record.country].filter(Boolean).map((v,i) => (
              <span key={i} style={{ background: C.faint, border: `1px solid ${C.border}`, borderRadius: 12, padding: "3px 10px", fontSize: 11, color: C.muted }}>{v}</span>
            ))}
          </div>

          {/* Condition */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 7 }}>Состояние</div>
            <div style={{ display: "flex", gap: 6 }}>
              {CONDITIONS.map(c => (
                <button key={c.key} onClick={() => setCondition(c.key)}
                  style={{ padding: "5px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${record.condition === c.key ? c.color : C.border}`,
                    background: record.condition === c.key ? c.bg : "transparent",
                    color: record.condition === c.key ? c.color : C.muted,
                    fontWeight: record.condition === c.key ? "bold" : "normal" }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <PriceBlock record={record} onUpdate={onUpdate} />

          <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: "bold", marginBottom: 12 }}>
            Треклист · {record.tracks?.length || 0} треков
          </div>
          <TrackList tracks={record.tracks} />
          {record.notes && (
            <div style={{ marginTop: 18, padding: "10px 14px", background: C.card, borderRadius: 8, fontSize: 12, color: C.muted, fontStyle: "italic", borderLeft: `3px solid ${C.accent}` }}>
              {record.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── StatsView ──────────────────────────────────────────────────────────────

function ExportButtons({ records }) {
  const [pdfStatus, setPdfStatus] = useState(null);
  const isLoading = pdfStatus && !pdfStatus.startsWith("error:");
  const isError   = pdfStatus?.startsWith("error:");
  const errMsg    = isError ? pdfStatus.replace("error:", "") : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => exportToExcel(records)}
          style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, whiteSpace: "nowrap" }}>
          ↓ Excel
        </button>
        <button onClick={() => !isLoading && exportToPDF(records, setPdfStatus)}
          disabled={isLoading}
          style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${isLoading ? C.faint : C.border}`, color: isLoading ? C.faint : C.muted, borderRadius: 6, cursor: isLoading ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: 12, whiteSpace: "nowrap" }}>
          {isLoading ? pdfStatus : "↓ PDF"}
        </button>
        <button onClick={() => exportJSON(records)}
          style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, color: "#5aaa5a", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, whiteSpace: "nowrap" }}>
          ↓ JSON
        </button>
      </div>
      {isError && (
        <div style={{ fontSize: 10, color: "#e06060", maxWidth: 200, textAlign: "right" }}>
          Ошибка PDF: {errMsg}
        </div>
      )}
    </div>
  );
}


function ImportSection({ onImported }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState("");
  const inputRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true); setResult("");
    try {
      const count = await importJSON(file, onImported);
      setResult("✓ Импортировано " + count + " альбомов");
    } catch (e) {
      setResult("✕ " + e.message);
    }
    setImporting(false);
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => inputRef.current?.click()} disabled={importing}
        style={{ width: "100%", padding: "12px", background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: "bold" }}>
        {importing ? "Импортирую..." : "↑ Восстановить из резервной копии"}
      </button>
      <input ref={inputRef} type="file" accept=".json" style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])} />
      {result && <div style={{ marginTop: 8, fontSize: 12, color: result.startsWith("✓") ? "#5aaa5a" : C.dangerText, textAlign: "center" }}>{result}</div>}
    </div>
  );
}

function StatsView({ records }) {
  const genres = {};
  const decades = {};
  records.forEach(r => {
    if (r.genre) genres[r.genre] = (genres[r.genre] || 0) + 1;
    if (r.year) { const d = Math.floor(+r.year/10)*10; decades[d] = (decades[d]||0)+1; }
  });
  const topGenres = Object.entries(genres).sort((a,b) => b[1]-a[1]).slice(0,8);
  const sortedDecades = Object.entries(decades).sort((a,b) => +a[0]-+b[0]);
  const maxG = Math.max(...topGenres.map(x=>x[1]), 1);
  const maxD = Math.max(...sortedDecades.map(x=>x[1]), 1);
  const topPriced = [...records].filter(r=>r.price).sort((a,b) => (b.price.high+b.price.low)-(a.price.high+a.price.low)).slice(0,5);
  const totalTracks = records.reduce((s,r) => s+(r.tracks?.length||0), 0);
  const priced = records.filter(r=>r.price);

  const barStyle = (val, max, color) => ({
    height: 8, borderRadius: 4, background: color || C.accent,
    width: `${Math.round(val/max*100)}%`, minWidth: 4, transition: "width 0.3s",
  });

  return (
    <div style={{ padding: 24 }}>
      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10, marginBottom: 28 }}>
        {[
          ["Альбомов", records.length, C.accent],
          ["Треков", totalTracks, "#7ab870"],
          ["Исполнителей", new Set(records.map(r=>r.artist)).size, "#4a9aaa"],
          ["Жанров", Object.keys(genres).length, "#c8a030"],
          ["С ценой", priced.length, "#7ab870"],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: "bold", color, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Genres */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Жанры</div>
          {topGenres.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>Нет данных</div> :
            topGenres.map(([g, n]) => (
              <div key={g} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: C.text }}>{g}</span>
                  <span style={{ color: C.muted }}>{n}</span>
                </div>
                <div style={{ height: 8, background: C.faint, borderRadius: 4 }}>
                  <div style={barStyle(n, maxG, C.accent)} />
                </div>
              </div>
            ))
          }
        </div>

        {/* Decades */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>По десятилетиям</div>
          {sortedDecades.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>Нет данных</div> :
            sortedDecades.map(([d, n]) => (
              <div key={d} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: C.text }}>{d}е</span>
                  <span style={{ color: C.muted }}>{n}</span>
                </div>
                <div style={{ height: 8, background: C.faint, borderRadius: 4 }}>
                  <div style={barStyle(n, maxD, "#4a9aaa")} />
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {/* Top by price */}
      {topPriced.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Самые ценные</div>
          {topPriced.map((r, i) => {
            const p = adjPrice(r.price, r.condition);
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10, marginBottom: 10, borderBottom: i < topPriced.length-1 ? `1px solid ${C.faint}` : "none" }}>
                <div style={{ fontSize: 18, fontWeight: "bold", color: C.faint, minWidth: 20 }}>{i+1}</div>
                {(r.thumbFront||r.thumb) && <img src={r.thumbFront||r.thumb} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.album}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{r.artist}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: "bold", color: "#7ab870", flexShrink: 0 }}>${p.low}–${p.high}</div>
                {r.condition && <ConditionBadge condition={r.condition} small />}
              </div>
            );
          })}
        </div>
      )}

      {/* Export */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => exportToExcel(records)}
          style={{ flex: 1, padding: "12px", background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: "bold", minWidth: 120 }}>
          ↓ Excel
        </button>
        <button onClick={() => exportToPDF(records, () => {})}
          style={{ flex: 1, padding: "12px", background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: "bold", minWidth: 120 }}>
          ↓ PDF
        </button>
        <button onClick={() => exportJSON(records)}
          style={{ flex: 1, padding: "12px", background: C.surface, border: `1px solid ${C.border}`, color: "#5aaa5a", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: "bold", minWidth: 120 }}>
          ↓ Резервная копия
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={() => exportToExcel(records)}
          style={{ flex: 1, padding: "12px", background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: "bold" }}>
          ↓ Excel
        </button>
        <button onClick={() => exportJSON(records)}
          style={{ flex: 1, padding: "12px", background: C.surface, border: `1px solid ${C.border}`, color: "#5aaa5a", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: "bold" }}>
          ↓ Резервная копия JSON
        </button>
      </div>
      <ImportSection onImported={rec => { setRecords(p => [...p, rec].sort((a,b) => (a.artist||"").localeCompare(b.artist||""))); }} />
    </div>
  );
}

// ── AddView ────────────────────────────────────────────────────────────────

function BalanceStatus({ refreshKey }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    dbCheckBalance().then(setInfo).catch(() => {});
  }, [refreshKey]);
  if (!info) return null;
  const remaining = info.remaining || 0;
  if (remaining > 0) return (
    <div style={{ marginBottom: 12, padding: "8px 12px", background: "#0e2a0e", border: "1px solid #1a4a1a", borderRadius: 8, fontSize: 12, color: "#5aaa5a" }}>
      🎵 Бесплатных попыток осталось: <strong>{remaining}</strong>
    </div>
  );
  if (!info.allowed) return (
    <div style={{ marginBottom: 12, padding: "8px 12px", background: "#2a0e0e", border: `1px solid ${C.danger}`, borderRadius: 8, fontSize: 12, color: C.dangerText }}>
      ⚠️ Баланс: ₽{info.balance}. Для добавления нужно ₽4. <strong>Пополните баланс во вкладке «₽ Баланс».</strong>
    </div>
  );
  return (
    <div style={{ marginBottom: 12, padding: "8px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.muted }}>
      Баланс: <strong style={{ color: C.accent }}>₽{info.balance}</strong> · Спишется ₽4 за альбом
    </div>
  );
}

function AddView({ onAdded }) {
  const [mode, setMode]       = useState("single"); // "single" | "batch"

  // ── Single mode state ────────────────────────────────────────────────
  const [front, setFront]       = useState(null);
  const [back,  setBack]        = useState(null);
  const [busy,  setBusy]        = useState(false);
  const [step,  setStep]        = useState("");
  const [err,   setErr]         = useState("");
  const [balanceRefresh, setBalanceRefresh] = useState(0);
  const frontRef = useRef(); const backRef = useRef();

  // ── Batch mode state ─────────────────────────────────────────────────
  const [pairs,    setPairs]    = useState([]); // [{front, back, frontPrev, backPrev}]
  const [batchRun, setBatchRun] = useState(false);
  const [batchIdx, setBatchIdx] = useState(0);
  const [batchDone,setBatchDone]= useState([]);  // completed results
  const [batchErr, setBatchErr] = useState([]);
  const batchRef = useRef();

  // ── Single helpers ───────────────────────────────────────────────────
  const pickFile = (file, side) => {
    if (!file?.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = e => {
      const preview = e.target.result;
      if (side === "front") setFront({ file, preview });
      else                  setBack({ file, preview });
    };
    reader.readAsDataURL(file);
  };

  const analyzeSingle = async () => {
    if (!front || !back || busy) return;
    setBusy(true); setErr("");
    try {
      setStep("Проверяю баланс...");
      let check;
      try {
        check = await dbCanAddAlbum();
      } catch (e) {
        setErr("Ошибка проверки баланса: " + e.message);
        setBusy(false);
        return;
      }
      if (!check.allowed) {
        setErr("Недостаточно средств. Баланс: ₽" + (check.balance || 0) + ". Пополните баланс во вкладке «₽ Баланс»");
        setBusy(false);
        return;
      }
      setStep("Обрезаю обложки...");
      const [thumbFront, thumbBack] = await Promise.all([smartCropToB64(front.file), smartCropToB64(back.file)]);
      setStep("ИИ читает пластинку...");
      const info = await callClaude(front.file, back.file);
      setStep("Ищу цену на Discogs...");
      const price = await fetchPrice(info.artist||"", info.album||"", info.label||null, info.year||null);
      setStep("Сохраняю...");
      const id = `vin:${Date.now()}`;
      const rec = {
        id, thumbFront, thumbBack, thumb: thumbFront,
        artist: info.artist||"Неизвестный", album: info.album||"Без названия",
        year: info.year||null, genre: info.genre||null, label: info.label||null,
        country: info.country||null, tracks: Array.isArray(info.tracks)?info.tracks:[],
        notes: info.notes||null, at: new Date().toISOString(),
        ...(price ? { price } : {}),
      };
      await dbSave(rec).catch(() => window.storage.set(id, JSON.stringify(rec)));
      setFront(null); setBack(null);
      setBalanceRefresh(k => k + 1);
      onAdded(rec);
    } catch (e) { setErr("Ошибка: " + (e.message||"что-то пошло не так")); }
    setBusy(false); setStep("");
  };

  // ── Batch helpers ────────────────────────────────────────────────────
  const handleBatchFiles = async (files) => {
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));

    const toPreview = (file) => new Promise(res => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = () => res(null);
      reader.readAsDataURL(file);
    });

    const newPairs = [];
    for (let i = 0; i + 1 < sorted.length; i += 2) {
      const [fp, bp] = await Promise.all([toPreview(sorted[i]), toPreview(sorted[i+1])]);
      newPairs.push({ front: sorted[i], back: sorted[i+1], frontPrev: fp, backPrev: bp });
    }
    if (sorted.length % 2 !== 0) {
      const last = sorted[sorted.length - 1];
      const fp = await toPreview(last);
      newPairs.push({ front: last, back: null, frontPrev: fp, backPrev: null });
    }
    setPairs(newPairs);
    setBatchDone([]); setBatchErr([]); setBatchRun(false); setBatchIdx(0);
  };

  const swapPair = (i) => {
    setPairs(p => {
      const updated = [...p];
      updated[i] = { ...updated[i], front: updated[i].back, back: updated[i].front, frontPrev: updated[i].backPrev, backPrev: updated[i].frontPrev };
      return updated;
    });
  };

  const removePair = (i) => {
    setPairs(p => {
      const updated = p.filter((_, idx) => idx !== i);
      return updated;
    });
  };

  const runBatch = async () => {
    if (!pairs.length || batchRun) return;
    setBatchRun(true);
    const done = []; const errs = [];
    for (let i = 0; i < pairs.length; i++) {
      setBatchIdx(i);
      const pair = pairs[i];
      if (!pair.back) { errs.push({ i, msg: "Нет задней стороны" }); continue; }
      try {
        const [thumbFront, thumbBack] = await Promise.all([
          smartCropToB64(pair.front),
          smartCropToB64(pair.back),
        ]);
        const info  = await callClaude(pair.front, pair.back);
        const price = await fetchPrice(info.artist||"", info.album||"", info.label||null, info.year||null);
        const id  = `vin:${Date.now()}_${i}`;
        const rec = {
          id, thumbFront, thumbBack, thumb: thumbFront,
          artist: info.artist||"Неизвестный", album: info.album||"Без названия",
          year: info.year||null, genre: info.genre||null, label: info.label||null,
          country: info.country||null, tracks: Array.isArray(info.tracks)?info.tracks:[],
          notes: info.notes||null, at: new Date().toISOString(),
          ...(price ? { price } : {}),
        };
        await dbSave(rec).catch(() => window.storage.set(id, JSON.stringify(rec)));
        onAdded(rec);
        done.push(rec);
      } catch (e) {
        errs.push({ i, msg: e.message || "ошибка" });
      }
      setBatchDone([...done]); setBatchErr([...errs]);
    }
    setBatchRun(false);
    setBatchIdx(-1);
  };

  const resetBatch = () => {
    setPairs([]); setBatchDone([]); setBatchErr([]); setBatchRun(false); setBatchIdx(0);
  };

  const batchFinished = !batchRun && batchIdx === -1 && (batchDone.length + batchErr.length) === pairs.length && pairs.length > 0;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: "bold", marginBottom: 6 }}>Добавить альбом</div>
        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", width: "fit-content", marginTop: 10 }}>
          {[["single","Один альбом"],["batch","Несколько альбомов"]].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ padding: "7px 18px", background: mode===m ? C.accent : "transparent", color: mode===m ? C.bg : C.muted, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: mode===m ? "bold" : "normal" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Single mode ── */}
      {mode === "single" && (
        <>
          <BalanceStatus refreshKey={balanceRefresh} />
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
            Загрузите фото лицевой и задней стороны.<br />Фон обрежется автоматически, ИИ распознает треки.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
            <UploadZone label="Лицевая сторона" state={front} inputRef={frontRef} onPick={f => pickFile(f,"front")} />
            <UploadZone label="Задняя сторона"  state={back}  inputRef={backRef}  onPick={f => pickFile(f,"back")} />
          </div>
          {err && <div style={{ background:"#200e0e", border:`1px solid ${C.danger}`, borderRadius:8, padding:"10px 14px", color:C.dangerText, fontSize:13, marginBottom:16 }}>{err}</div>}
          {busy && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <svg width="64" height="64" viewBox="-90 -90 180 180"
                style={{ animation: "vinyl-spin 2s linear infinite", display: "inline-block" }}>
                <style>{`@keyframes vinyl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                <circle cx="0" cy="0" r="85" fill="#0D1B2A" stroke="#C8A96E" strokeWidth="2" opacity="0.5"/>
                <circle cx="0" cy="0" r="70" fill="none" stroke="#C8A96E" strokeWidth="1" opacity="0.4"/>
                <circle cx="0" cy="0" r="55" fill="none" stroke="#C8A96E" strokeWidth="1" opacity="0.35"/>
                <circle cx="0" cy="0" r="40" fill="none" stroke="#C8A96E" strokeWidth="1" opacity="0.3"/>
                <circle cx="0" cy="0" r="28" fill="#112234" stroke="#C8A96E" strokeWidth="1.5"/>
                <path d="M -20 -3 C -13 -10, -6 -10, 0 -3 C 6 4, 13 4, 20 -3" fill="none" stroke="#2E6B8A" strokeWidth="2" strokeLinecap="round"/>
                <circle cx="0" cy="0" r="4" fill="#C8A96E"/>
                <circle cx="0" cy="0" r="2" fill="#0D1B2A"/>
              </svg>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 8, fontFamily: C.fMono, letterSpacing: "0.08em" }}>{step || "обрабатываю..."}</div>
            </div>
          )}
          <button onClick={analyzeSingle} disabled={!front||!back||busy}
            style={{ width:"100%", padding:"13px", background:(front&&back&&!busy)?C.accent:C.border, color:(front&&back&&!busy)?C.bg:C.muted, border:"none", borderRadius:8, fontSize:14, fontFamily:C.fDisplay, fontStyle:"italic", cursor:(front&&back&&!busy)?"pointer":"not-allowed", display: busy ? "none" : "block" }}>
            ♪ Анализировать и добавить
          </button>
        </>
      )}

      {/* ── Batch mode ── */}
      {mode === "batch" && (
        <>
          {pairs.length === 0 ? (
            <>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
                Выберите сразу все фото. Файлы будут отсортированы по имени и разбиты на пары:<br />
                <strong style={{ color: C.text }}>1-е фото = лицевая, 2-е = задняя, 3-е = лицевая, 4-е = задняя...</strong>
              </div>
              <div
                onClick={() => batchRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleBatchFiles(e.dataTransfer.files); }}
                style={{ border: `2px dashed ${C.accent}`, borderRadius: 12, padding: "48px 24px", textAlign: "center", cursor: "pointer", background: C.surface }}>
                <div style={{ fontSize: 36, color: C.faint, marginBottom: 12 }}>+</div>
                <div style={{ fontSize: 14, color: C.text, marginBottom: 6 }}>Нажмите или перетащите фото</div>
                <div style={{ fontSize: 11, color: C.muted }}>Выберите чётное количество файлов (пары лицевая + задняя)</div>
              </div>
              <input ref={batchRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={e => handleBatchFiles(e.target.files)} />
            </>
          ) : (
            <>
              {/* Pairs preview */}
              {!batchFinished && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontSize: 13, color: C.muted }}>
                      {pairs.length} {pairs.length===1?"пара":"пар"} · {pairs.length*2} фото
                    </div>
                    <button onClick={resetBatch} style={{ fontSize: 11, color: C.muted, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                      × Сбросить
                    </button>
                  </div>

                  {/* Pairs grid */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                    {pairs.map((pair, i) => {
                      const isDone   = batchDone.length > i && batchRun === false && batchIdx === -1;
                      const isActive = batchRun && batchIdx === i;
                      const isErr    = batchErr.find(e => e.i === i);
                      const isDoneRec= batchDone.find((_, di) => {
                        const doneIs = pairs.slice(0, i+1).filter((_, pi) => !batchErr.find(e=>e.i===pi)).length - 1;
                        return di === doneIs;
                      });

                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: isActive ? "#1e1a0e" : C.card, border: `1px solid ${isActive ? C.accent : isErr ? C.danger : C.border}`, borderRadius: 10 }}>
                          <div style={{ fontSize: 12, color: C.muted, minWidth: 20, textAlign: "center", fontWeight: "bold" }}>{i+1}</div>
                          {/* Front */}
                          <div style={{ flex: 1, textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>Лицевая</div>
                            {pair.frontPrev
                              ? <img src={pair.frontPrev} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 5, border: `1px solid ${C.border}` }} />
                              : <div style={{ width: 60, height: 60, background: C.faint, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 10 }}>—</div>
                            }
                            <div style={{ fontSize: 9, color: C.faint, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>{pair.front?.name}</div>
                          </div>
                          {/* Swap button */}
                          {!batchRun && (
                            <button onClick={() => swapPair(i)} title="Поменять стороны"
                              style={{ background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 14 }}>
                              ⇄
                            </button>
                          )}
                          {/* Back */}
                          <div style={{ flex: 1, textAlign: "center" }}>
                            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>Задняя</div>
                            {pair.backPrev
                              ? <img src={pair.backPrev} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 5, border: `1px solid ${C.border}` }} />
                              : <div style={{ width: 60, height: 60, background: C.faint, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 10 }}>—</div>
                            }
                            <div style={{ fontSize: 9, color: C.faint, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>{pair.back?.name}</div>
                          </div>
                          {/* Status */}
                          <div style={{ minWidth: 24, textAlign: "center" }}>
                            {isActive && <div style={{ fontSize: 16, color: C.accent }}>⟳</div>}
                            {isErr    && <div style={{ fontSize: 14, color: C.dangerText }}>✕</div>}
                            {!isActive && !isErr && batchIdx > i && <div style={{ fontSize: 14, color: "#5aaa5a" }}>✓</div>}
                          </div>
                          {/* Remove */}
                          {!batchRun && (
                            <button onClick={() => removePair(i)}
                              style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 16, padding: "0 2px" }}>
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Progress bar */}
                  {batchRun && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 6 }}>
                        <span>Обрабатываю альбом {batchIdx + 1} из {pairs.length}...</span>
                        <span>{Math.round((batchIdx / pairs.length) * 100)}%</span>
                      </div>
                      <div style={{ height: 6, background: C.faint, borderRadius: 3 }}>
                        <div style={{ height: "100%", borderRadius: 3, background: C.accent, width: `${Math.round((batchIdx / pairs.length) * 100)}%`, transition: "width 0.3s" }} />
                      </div>
                    </div>
                  )}

                  <button onClick={runBatch} disabled={batchRun || pairs.every(p => !p.back)}
                    style={{ width:"100%", padding:"13px", background: batchRun ? C.border : C.accent, color: batchRun ? C.muted : C.bg, border:"none", borderRadius:8, fontSize:15, fontFamily:"inherit", fontWeight:"bold", cursor: batchRun ? "not-allowed" : "pointer" }}>
                    {batchRun ? `Обрабатываю ${batchIdx+1} из ${pairs.length}...` : `♪ Добавить ${pairs.length} ${pairs.length===1?"альбом":pairs.length<5?"альбома":"альбомов"}`}
                  </button>
                </>
              )}

              {/* Results */}
              {batchFinished && (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>
                    {batchErr.length === 0 ? "🎵" : "⚠️"}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: "bold", color: C.text, marginBottom: 8 }}>
                    {batchDone.length > 0 && `Добавлено: ${batchDone.length} ${batchDone.length===1?"альбом":batchDone.length<5?"альбома":"альбомов"}`}
                  </div>
                  {batchErr.length > 0 && (
                    <div style={{ fontSize: 13, color: C.dangerText, marginBottom: 12 }}>
                      Ошибок: {batchErr.length}
                    </div>
                  )}
                  <button onClick={resetBatch}
                    style={{ padding: "10px 24px", background: C.accent, color: C.bg, border: "none", borderRadius: 8, fontFamily: "inherit", fontSize: 14, fontWeight: "bold", cursor: "pointer", marginTop: 8 }}>
                    Добавить ещё
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}




function AdminPanel({ onClose }) {
  const [count,  setCount]  = useState(10);
  const [amount, setAmount] = useState(100);
  const [note,   setNote]   = useState("");
  const [codes,  setCodes]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const generate = async () => {
    setLoading(true); setErr("");
    try {
      const result = await dbGenerateCodes(count, amount, note);
      setCodes(result);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };

  const copyAll = () => {
    const text = codes.map(c => c.code + " — ₽" + c.amount).join("\n");
    navigator.clipboard?.writeText(text);
  };

  const inputStyle = { width: "100%", padding: "9px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <button onClick={onClose} style={{ marginBottom: 20, padding: "7px 16px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>← Назад</button>
      <div style={{ fontSize: 18, fontWeight: "bold", marginBottom: 20, color: C.accent }}>Генератор кодов</div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Количество кодов</div>
            <input type="number" value={count} onChange={e => setCount(+e.target.value)} min={1} max={100} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Номинал (₽)</div>
            <input type="number" value={amount} onChange={e => setAmount(+e.target.value)} min={1} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Заметка (необязательно)</div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Например: для Telegram канала" style={inputStyle} />
        </div>
        {err && <div style={{ fontSize: 12, color: C.dangerText, marginBottom: 8 }}>{err}</div>}
        <button onClick={generate} disabled={loading}
          style={{ width: "100%", padding: "12px", background: loading ? C.border : C.accent, color: loading ? C.muted : C.bg, border: "none", borderRadius: 8, fontFamily: "inherit", fontSize: 14, fontWeight: "bold", cursor: loading ? "not-allowed" : "pointer" }}>
          {loading ? "Генерирую..." : `Создать ${count} код${count === 1 ? "" : count < 5 ? "а" : "ов"} по ₽${amount}`}
        </button>
      </div>

      {codes.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: C.text, fontWeight: "bold" }}>Сгенерировано {codes.length} кодов</div>
            <button onClick={copyAll} style={{ padding: "5px 12px", background: C.card, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11 }}>
              Копировать все
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
            {codes.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: C.card, borderRadius: 8 }}>
                <span style={{ fontSize: 13, color: C.accent, letterSpacing: "0.05em", fontWeight: "bold" }}>{c.code}</span>
                <span style={{ fontSize: 12, color: "#5aaa5a" }}>₽{c.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function AboutView() {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 24px" }}>
      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ margin: "0 auto 16px", display: "flex", justifyContent: "center" }}>
          <LogoMark size={72} />
        </div>
        <div style={{ fontSize: 28, fontWeight: "bold", color: C.accent, letterSpacing: "0.04em", marginBottom: 8 }}>vinyldarksea</div>
        <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, maxWidth: 380, margin: "0 auto" }}>
          Каждая твоя пластинка заслуживает быть оцифрованной
        </div>
      </div>

      {/* Mission */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", marginBottom: 16, borderLeft: `3px solid ${C.accent}` }}>
        <div style={{ fontSize: 11, color: C.accent, textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: "bold", marginBottom: 10 }}>Миссия</div>
        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7 }}>
          Мы создаём первый удобный русскоязычный каталог для коллекционеров винила. 
          Твоя коллекция — живая история музыки. Она заслуживает лучшего чем Excel.
        </div>
      </div>

      {/* Three pillars */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          ["🇷🇺", "На русском", "Единственный нормальный вариант для коллекционера"],
          ["📱", "Всегда под рукой", "Веб и мобильный, данные в облаке"],
          ["🎵", "Умный каталог", "ИИ распознаёт пластинку по фото"],
        ].map(([icon, title, desc]) => (
          <div key={title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
            <div style={{ fontSize: 11, fontWeight: "bold", color: C.text, marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.accent, textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: "bold", marginBottom: 14 }}>Возможности</div>
        {[
          "Анализ пластинки по фото — ИИ распознаёт исполнителя, треклист, год",
          "Автоматическая оценка стоимости по данным Discogs",
          "Фильтры по жанру, году, состоянию, цене",
          "Пакетная загрузка — сразу несколько альбомов",
          "Экспорт каталога в Excel и резервная копия JSON",
          "Многопользовательский режим — у каждого свой каталог",
        ].map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: i < 5 ? `1px solid ${C.faint}` : "none" }}>
            <span style={{ color: C.accent2, flexShrink: 0 }}>✦</span>
            <span style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{f}</span>
          </div>
        ))}
      </div>

      {/* Pricing */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: C.accent, textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: "bold", marginBottom: 14 }}>Тарифы</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ background: C.card, borderRadius: 10, padding: "16px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: C.text, marginBottom: 6 }}>Бесплатно</div>
            <div style={{ fontSize: 22, fontWeight: "bold", color: "#5aaa5a", marginBottom: 8 }}>₽0</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>50 пластинок без оплаты. Навсегда.</div>
          </div>
          <div style={{ background: C.card, borderRadius: 10, padding: "16px", border: `1px solid ${C.accent}` }}>
            <div style={{ fontSize: 13, fontWeight: "bold", color: C.accent, marginBottom: 6 }}>Платно</div>
            <div style={{ fontSize: 22, fontWeight: "bold", color: C.accent, marginBottom: 8 }}>₽4</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>За каждую пластинку сверх лимита.</div>
          </div>
        </div>
      </div>

      {/* Contacts */}
      <div style={{ textAlign: "center", padding: "16px 0", fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
        <div style={{ fontSize: 13, color: C.accent, marginBottom: 8, fontWeight: "bold" }}>vinyldarksea</div>
        <div>vinyldarksea.ru · vinyldarksea.biz</div>
        <div style={{ marginTop: 8, fontSize: 10, color: C.faint }}>© 2025 vinyldarksea. Все права защищены.</div>
      </div>
    </div>
  );
}

function BalanceView({ onClose }) {
  const [bal,  setBal]   = useState(null);
  const [txns, setTxns]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);
  const [promoCode,  setPromoCode]  = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoMsg, setPromoMsg] = useState(null);

  const activatePromo = async () => {
    if (!promoCode || promoLoading) return;
    setPromoLoading(true); setPromoMsg(null);
    try {
      const amount = await dbActivatePromo(promoCode);
      setPromoMsg({ ok: true, text: "✓ Баланс пополнен на ₽" + amount });
      setPromoCode("");
      const [b, t] = await Promise.all([dbGetBalance(), dbGetTransactions()]);
      setBal(b); setTxns(t);
    } catch (e) {
      setPromoMsg({ ok: false, text: "✕ " + e.message });
    }
    setPromoLoading(false);
  };

  useEffect(() => {
    Promise.all([dbGetBalance(), dbGetTransactions()]).then(([b, t]) => {
      setBal(b); setTxns(t); setLoading(false);
    });
  }, []);

  const AMOUNTS = [100, 200, 500, 1000];

  if (loading) return (
    <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Загрузка...</div>
  );

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px" }}>
      <button onClick={onClose} style={{ marginBottom: 20, padding: "7px 16px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
        ← Назад
      </button>

      {/* Balance card */}
      <div style={{ background: "linear-gradient(135deg,#1e1a10 0%,#252018 100%)", border: `1px solid #4a3a1a`, borderRadius: 12, padding: "20px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6 }}>Мой баланс</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 36, fontWeight: "bold", color: C.accent }}>₽ {bal?.balance || 0}</span>
          <span style={{ fontSize: 12, color: C.muted }}>доступно</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            ["Пластинок", bal ? bal.used_free + (bal.balance > 0 ? Math.floor(bal.balance / 4) : 0) : 0, C.text],
            ["Бесплатных", bal?.free_albums || 50, "#5aaa5a"],
            ["Использовано", bal?.used_free || 0, C.accent],
          ].map(([label, val, color]) => (
            <div key={label} style={{ background: C.card, borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: "bold", color, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setTopupOpen(!topupOpen)}
          style={{ width: "100%", padding: "12px", background: C.accent, border: "none", borderRadius: 8, color: C.bg, fontSize: 14, fontFamily: "inherit", fontWeight: "bold", cursor: "pointer" }}>
          {topupOpen ? "Скрыть" : "Пополнить баланс"}
        </button>
      </div>

      {/* Topup section */}
      {topupOpen && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          {/* Promo code activation */}
          <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Активировать код пополнения</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={promoCode}
              onChange={e => setPromoCode(e.target.value.toUpperCase())}
              placeholder="VINYL-XXXXXX"
              style={{ flex: 1, padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, fontFamily: "inherit", outline: "none", letterSpacing: "0.05em" }}
              onKeyDown={e => e.key === "Enter" && activatePromo()}
            />
            <button onClick={activatePromo} disabled={promoLoading || !promoCode}
              style={{ padding: "10px 16px", background: promoCode && !promoLoading ? C.accent : C.border, color: promoCode && !promoLoading ? C.bg : C.muted, border: "none", borderRadius: 8, fontFamily: "inherit", fontSize: 13, fontWeight: "bold", cursor: promoCode && !promoLoading ? "pointer" : "not-allowed" }}>
              {promoLoading ? "..." : "Активировать"}
            </button>
          </div>
          {promoMsg && (
            <div style={{ fontSize: 12, padding: "8px 12px", borderRadius: 6, background: promoMsg.ok ? "#0e2a0e" : "#2a0e0e", color: promoMsg.ok ? "#5aaa5a" : C.dangerText, marginBottom: 8 }}>
              {promoMsg.text}
            </div>
          )}
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>Для получения кода обратитесь к администратору</div>
        </div>
      )}

      {/* Transactions */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>История операций</div>
        {txns.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Операций пока нет</div>
        ) : txns.map((t, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < txns.length-1 ? `1px solid ${C.faint}` : "none" }}>
            <div>
              <div style={{ fontSize: 12, color: C.text }}>{t.description}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{new Date(t.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: "bold", color: t.amount > 0 ? "#5aaa5a" : "#e06060" }}>
              {t.amount > 0 ? "+" : ""}{t.amount} ₽
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


function LogoMark({ size = 32 }) {
  const s = size / 180;
  return (
    <svg width={size} height={size} viewBox="-90 -90 180 180" style={{ flexShrink: 0 }}>
      <circle cx="0" cy="0" r="88" fill="none" stroke="#C8A96E" strokeWidth="1.2" opacity="0.35"/>
      <circle cx="0" cy="0" r="78" fill="none" stroke="#C8A96E" strokeWidth="1.0" opacity="0.45"/>
      <circle cx="0" cy="0" r="68" fill="none" stroke="#C8A96E" strokeWidth="1.0" opacity="0.55"/>
      <circle cx="0" cy="0" r="58" fill="none" stroke="#C8A96E" strokeWidth="0.9" opacity="0.65"/>
      <circle cx="0" cy="0" r="49" fill="none" stroke="#C8A96E" strokeWidth="0.9" opacity="0.75"/>
      <circle cx="0" cy="0" r="38" fill="#112234" stroke="#C8A96E" strokeWidth="1"/>
      <path d="M -26 -4 C -18 -13, -9 -13, 0 -4 C 9 5, 18 5, 26 -4" fill="none" stroke="#2E6B8A" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M -26 4 C -18 -5, -9 -5, 0 4 C 9 13, 18 13, 26 4" fill="none" stroke="#2E6B8A" strokeWidth="1.3" strokeLinecap="round" opacity="0.6"/>
      <path d="M -88 0 C -58 17, -29 26, 0 22 C 29 18, 58 7, 88 0" fill="none" stroke="#2E6B8A" strokeWidth="1.8" opacity="0.7" strokeLinecap="round"/>
      <circle cx="0" cy="0" r="4" fill="#C8A96E"/>
      <circle cx="0" cy="0" r="2" fill="#0D1B2A"/>
    </svg>
  );
}


// ── LandingPage ────────────────────────────────────────────────────────────
function LandingPage({ onStart }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: C.fBody }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 32px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogoMark size={36} />
          <div style={{ fontSize: 18, color: C.accent, fontFamily: C.fDisplay, fontStyle: "italic" }}>vinyldarksea</div>
        </div>
        <button onClick={onStart} style={{ padding: "9px 22px", background: C.accent, color: C.bg, border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: C.fMono, fontWeight: "bold" }}>
          Войти
        </button>
      </div>

      {/* Hero */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "72px 24px 48px", textAlign: "center" }}>
        <div style={{ fontSize: 9, color: C.accent2, fontFamily: C.fMono, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 20 }}>Первый русскоязычный AI-каталог</div>
        <h1 style={{ fontSize: 42, fontFamily: C.fDisplay, fontStyle: "italic", fontWeight: 400, lineHeight: 1.15, marginBottom: 20, color: C.text }}>
          Ваша коллекция винила<br />в цифровом виде
        </h1>
        <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.8, marginBottom: 36, maxWidth: 480, margin: "0 auto 36px" }}>
          Сфотографируйте пластинку. Искусственный интеллект распознает релиз, создаст каталог и сохранит вашу музыкальную историю.
        </p>
        <button onClick={onStart}
          style={{ padding: "14px 40px", background: C.accent, color: C.bg, border: "none", borderRadius: 10, cursor: "pointer", fontSize: 15, fontFamily: C.fDisplay, fontStyle: "italic", letterSpacing: "0.03em" }}>
          Начать каталог бесплатно
        </button>
        <div style={{ marginTop: 12, fontSize: 11, color: C.muted, fontFamily: C.fMono }}>50 пластинок бесплатно · без кредитной карты</div>
      </div>

      {/* Features */}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 24px 64px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        {[
          ["🎵", "AI-распознавание", "Не нужно вводить данные вручную. Просто сфотографируйте."],
          ["💰", "Оценка стоимости", "Узнайте примерную стоимость своей коллекции по данным Discogs."],
          ["📊", "Статистика", "Структура коллекции по жанрам, десятилетиям, исполнителям."],
          ["🌐", "Публичные коллекции", "Покажите коллекцию другим коллекционерам. Красивая ссылка."],
        ].map(([icon, title, desc]) => (
          <div key={title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 18px" }}>
            <div style={{ fontSize: 24, marginBottom: 10 }}>{icon}</div>
            <div style={{ fontSize: 13, fontWeight: "bold", color: C.text, marginBottom: 8 }}>{title}</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Problem / Solution */}
      <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: "48px 24px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: C.fMono, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Проблема</div>
          <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.8, marginBottom: 32 }}>
            Сегодня коллекционеры используют Excel, блокноты, Telegram и фотографии на телефоне. Информация разбросана. Коллекции скрыты.
          </p>
          <div style={{ fontSize: 11, color: C.accent, fontFamily: C.fMono, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 16 }}>Решение</div>
          <p style={{ fontSize: 15, color: C.text, lineHeight: 1.8 }}>
            Vinyldarksea создаёт цифровой паспорт коллекции с красивой публичной страницей, которой можно поделиться.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "32px 24px", textAlign: "center", fontSize: 11, color: C.muted, fontFamily: C.fMono }}>
        © 2025–2026 vinyldarksea · vinyldarksea.ru
      </div>
    </div>
  );
}


// ── ProfileSetupModal ───────────────────────────────────────────────────────
function ProfileSetupModal({ profile, onSave, onClose }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [username, setUsername] = useState(profile?.username || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [city, setCity] = useState(profile?.city || "");
  const [isPublic, setIsPublic] = useState(profile?.is_collection_public || false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!username.trim()) { setErr("Никнейм обязателен"); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(username)) { setErr("Никнейм: только a-z, 0-9, _, от 3 до 30 символов"); return; }
    setSaving(true); setErr("");
    try {
      const saved = await dbSaveProfile({ display_name: displayName, username, bio, city, is_collection_public: isPublic });
      onSave(saved || { display_name: displayName, username, bio, city, is_collection_public: isPublic });
    } catch (e) {
      setErr(e.message.includes("profiles_username_key") ? "Этот никнейм уже занят" : "Ошибка: " + e.message);
    }
    setSaving(false);
  };

  const inputStyle = { width: "100%", padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none" };
  const labelStyle = { fontSize: 11, color: C.muted, fontFamily: C.fMono, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, display: "block" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, maxWidth: 440, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 20, fontFamily: C.fDisplay, fontStyle: "italic", color: C.text, marginBottom: 6 }}>Профиль коллекционера</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 24 }}>Другие коллекционеры увидят ваш профиль</div>

        <label style={labelStyle}>Имя / Псевдоним</label>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Борис Барциц" style={{ ...inputStyle, marginBottom: 16 }} />

        <label style={labelStyle}>Никнейм <span style={{ color: C.accent }}>@</span></label>
        <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="boris" style={{ ...inputStyle, marginBottom: 4 }} />
        <div style={{ fontSize: 10, color: C.muted, fontFamily: C.fMono, marginBottom: 16 }}>vinyldarksea.ru/#/u/{username || "boris"}</div>

        <label style={labelStyle}>О себе</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Коллекционирую советский джаз с 1997 года..." rows={3}
          style={{ ...inputStyle, resize: "vertical", marginBottom: 16 }} />

        <label style={labelStyle}>Город (необязательно)</label>
        <input value={city} onChange={e => setCity(e.target.value)} placeholder="Сухум" style={{ ...inputStyle, marginBottom: 20 }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: C.surface, borderRadius: 8, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, color: C.text }}>Публичная коллекция</div>
            <div style={{ fontSize: 11, color: C.muted }}>Другие смогут видеть ваши пластинки</div>
          </div>
          <button onClick={() => setIsPublic(!isPublic)}
            style={{ width: 44, height: 24, borderRadius: 12, background: isPublic ? C.accent : C.border, border: "none", cursor: "pointer", transition: "background 0.2s", position: "relative" }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: C.bg, position: "absolute", top: 3, left: isPublic ? 23 : 3, transition: "left 0.2s" }} />
          </button>
        </div>

        {/* Bulk actions */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={async () => {
            try { await dbSetAllPublic(true); alert("Все пластинки теперь публичные!"); }
            catch(e) { alert("Ошибка: " + e.message); }
          }} style={{ flex: 1, padding: "8px", background: "transparent", border: `1px solid ${C.accent2}`, color: C.accent2, borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: C.fMono }}>
            🌐 Все публичными
          </button>
          <button onClick={async () => {
            try { await dbSetAllPublic(false); alert("Все пластинки теперь приватные."); }
            catch(e) { alert("Ошибка: " + e.message); }
          }} style={{ flex: 1, padding: "8px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: C.fMono }}>
            🔒 Все приватными
          </button>
        </div>

        {err && <div style={{ color: C.dangerText, fontSize: 12, marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          {onClose && <button onClick={onClose} style={{ flex: 1, padding: "11px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>Позже</button>}
          <button onClick={save} disabled={saving}
            style={{ flex: 2, padding: "11px", background: C.accent, color: C.bg, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: C.fDisplay, fontStyle: "italic", fontSize: 14 }}>
            {saving ? "Сохраняю..." : "Сохранить профиль"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── PublicProfilePage ──────────────────────────────────────────────────────
function PublicProfilePage({ username, onLogin }) {
  const [profile, setProfile] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const p = await dbGetPublicProfile(username);
      if (!p) { setNotFound(true); setLoading(false); return; }
      setProfile(p);
      const albs = p.is_collection_public ? await dbGetAllPublicAlbums(p.id) : await dbGetPublicAlbums(p.id);
      setAlbums(albs);
      setLoading(false);
    })();
  }, [username]);

  const share = () => {
    const url = window.location.origin + window.location.pathname + "#/u/" + username;
    if (navigator.share) {
      navigator.share({ title: `Коллекция ${profile?.display_name || username}`, url });
    } else {
      navigator.clipboard.writeText(url);
      alert("Ссылка скопирована!");
    }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.muted, fontFamily: C.fMono }}>Загрузка...</div>
    </div>
  );

  if (notFound) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <LogoMark size={48} />
      <div style={{ color: C.muted, fontFamily: C.fDisplay, fontStyle: "italic", fontSize: 18 }}>Коллекционер не найден</div>
      <button onClick={onLogin} style={{ padding: "9px 22px", background: C.accent, color: C.bg, border: "none", borderRadius: 8, cursor: "pointer", marginTop: 8, fontFamily: C.fMono }}>
        На главную
      </button>
    </div>
  );

  const stats = [
    ["пластинок", albums.length],
    ["исполнителей", new Set(albums.map(a => a.artist)).size],
    ["треков", albums.reduce((s, a) => s + (a.tracks?.length || 0), 0)],
    ["жанров", new Set(albums.map(a => a.genre).filter(Boolean)).size],
  ];

  const priced = albums.filter(a => a.price);
  const totalLow = priced.reduce((s, a) => s + (a.price?.low || 0), 0);
  const totalHigh = priced.reduce((s, a) => s + (a.price?.high || 0), 0);

  const top10 = [...albums].filter(a => a.price).sort((a, b) => (b.price?.median || 0) - (a.price?.median || 0)).slice(0, 10);
  const recent20 = [...albums].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 20);

  const genres = {};
  albums.forEach(a => { if (a.genre) genres[a.genre] = (genres[a.genre] || 0) + 1; });
  const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const initials = (profile.display_name || username || "?").substring(0, 2).toUpperCase();

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: C.fBody }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.surface, zIndex: 100, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogoMark size={32} />
          <div style={{ fontSize: 15, color: C.accent, fontFamily: C.fDisplay, fontStyle: "italic" }}>vinyldarksea</div>
        </div>
        <button onClick={onLogin} style={{ padding: "8px 18px", background: C.accent, color: C.bg, border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: C.fMono }}>
          Войти
        </button>
      </div>

      {/* Profile header */}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24, marginBottom: 32, flexWrap: "wrap" }}>
          {/* Avatar */}
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: "bold", color: C.bg, fontFamily: C.fDisplay, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 26, fontFamily: C.fDisplay, fontStyle: "italic", color: C.text, marginBottom: 4 }}>{profile.display_name || username}</div>
            <div style={{ fontSize: 13, color: C.accent2, fontFamily: C.fMono, marginBottom: 8 }}>@{profile.username}</div>
            {profile.bio && <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, marginBottom: 8 }}>{profile.bio}</div>}
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, fontFamily: C.fMono, flexWrap: "wrap" }}>
              {profile.city && <span>📍 {profile.city}</span>}
              {profile.created_at && <span>Участник с {new Date(profile.created_at).getFullYear()}</span>}
            </div>
          </div>
          <button onClick={share} style={{ padding: "9px 18px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: C.fMono, display: "flex", alignItems: "center", gap: 6 }}>
            ↗ Поделиться
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 32 }}>
          {stats.map(([label, val]) => (
            <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: 26, fontFamily: C.fDisplay, fontStyle: "italic", color: C.accent, lineHeight: 1 }}>{val.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontFamily: C.fMono }}>{label}</div>
            </div>
          ))}
          {totalLow > 0 && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px", textAlign: "center", gridColumn: "span 2" }}>
              <div style={{ fontSize: 20, fontFamily: C.fDisplay, fontStyle: "italic", color: "#6dbf6d", lineHeight: 1 }}>
                ${totalLow.toLocaleString()}–${totalHigh.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontFamily: C.fMono }}>оценочная стоимость</div>
            </div>
          )}
        </div>

        {/* Genres */}
        {topGenres.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.fMono, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Жанры</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {topGenres.map(([genre, count]) => {
                const pct = Math.round(count / albums.length * 100);
                return (
                  <div key={genre} style={{ padding: "6px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, fontSize: 12, color: C.text }}>
                    {genre} <span style={{ color: C.accent, fontFamily: C.fMono }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top 10 */}
        {top10.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.fMono, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Самые ценные</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {top10.map(r => {
                const p = adjPrice(r.price, r.condition);
                return (
                  <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ aspectRatio: "1", background: C.surface }}>
                      {(r.thumb || r.thumbFront)
                        ? <img src={r.thumb || r.thumbFront} alt={r.album} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#060e18" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><LogoMark size={36} /></div>}
                    </div>
                    <div style={{ padding: "8px 10px" }}>
                      <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: C.fDisplay }}>{r.album}</div>
                      <div style={{ fontSize: 9, color: C.accent, fontFamily: C.fMono, marginTop: 2 }}>{r.artist}</div>
                      <div style={{ fontSize: 10, color: "#6dbf6d", fontFamily: C.fMono, marginTop: 3 }}>${p.low}–${p.high}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent */}
        {recent20.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.fMono, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14 }}>Последние добавления</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {recent20.map(r => (
                <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ aspectRatio: "1", background: C.surface }}>
                    {(r.thumb || r.thumbFront)
                      ? <img src={r.thumb || r.thumbFront} alt={r.album} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#060e18" }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><LogoMark size={36} /></div>}
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: C.fDisplay }}>{r.album}</div>
                    <div style={{ fontSize: 9, color: C.accent, fontFamily: C.fMono, marginTop: 2 }}>{r.artist}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {albums.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.muted, fontFamily: C.fDisplay, fontStyle: "italic" }}>
            Коллекция пока закрыта или пуста
          </div>
        )}

        {/* CTA */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "24px", textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 16, fontFamily: C.fDisplay, fontStyle: "italic", marginBottom: 8 }}>Хотите создать свою коллекцию?</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Первые 50 пластинок бесплатно</div>
          <button onClick={onLogin} style={{ padding: "11px 28px", background: C.accent, color: C.bg, border: "none", borderRadius: 8, cursor: "pointer", fontFamily: C.fDisplay, fontStyle: "italic" }}>
            Начать бесплатно
          </button>
        </div>
      </div>

      <div style={{ padding: "16px", textAlign: "center", fontSize: 10, color: C.muted, fontFamily: C.fMono, borderTop: `1px solid ${C.border}` }}>
        © 2025–2026 vinyldarksea
      </div>
    </div>
  );
}


// ── ShareButton ────────────────────────────────────────────────────────────
function ShareButton({ username }) {
  const [open, setOpen] = useState(false);
  const url = window.location.origin + window.location.pathname + "#/u/" + username;

  const copyLink = () => { navigator.clipboard.writeText(url); setOpen(false); alert("Ссылка скопирована!"); };
  const shareOn = (platform) => {
    const text = encodeURIComponent("Моя коллекция винила на vinyldarksea");
    const u = encodeURIComponent(url);
    const map = {
      telegram: `https://t.me/share/url?url=${u}&text=${text}`,
      whatsapp: `https://wa.me/?text=${text}%20${u}`,
      vk: `https://vk.com/share.php?url=${u}&title=${text}`,
    };
    window.open(map[platform], "_blank");
    setOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: C.fMono }}>
        ↗ Поделиться
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px", zIndex: 200, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: C.fMono, padding: "4px 10px 8px", borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
            {url.length > 40 ? "..." + url.slice(-36) : url}
          </div>
          {[["📋 Скопировать ссылку", copyLink], ["✈️ Telegram", () => shareOn("telegram")], ["💬 WhatsApp", () => shareOn("whatsapp")], ["🔵 VK", () => shareOn("vk")]].map(([label, fn]) => (
            <button key={label} onClick={fn} style={{ display: "block", width: "100%", padding: "8px 10px", background: "transparent", border: "none", color: C.text, cursor: "pointer", textAlign: "left", fontSize: 13, borderRadius: 6 }}
              onMouseEnter={e => e.target.style.background = C.surface}
              onMouseLeave={e => e.target.style.background = "transparent"}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AuthScreen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode,  setMode]  = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState("");
  const [info,  setInfo]  = useState("");

  const submit = async () => {
    if (!email || !pass) { setErr("Введите email и пароль"); return; }
    setBusy(true); setErr(""); setInfo("");
    try {
      if (mode === "register") {
        await authSignUp(email, pass);
        setInfo("Проверьте почту — отправили письмо для подтверждения");
        setMode("login");
      } else {
        const session = await authSignIn(email, pass);
        const sessData = { token: session.access_token, refreshToken: session.refresh_token, userId: session.user?.id, email };
        try { await window.storage.set("session", JSON.stringify(sessData)); } catch {}
        onAuth(sessData);
      }
    } catch (e) {
      if (e.message === "Failed to fetch") {
        setErr("Не удалось подключиться к серверу. Возможно CORS — добавьте * в Supabase → Settings → API → CORS Allowed Origins");
      } else {
        setErr(e.message);
      }
    }
    setBusy(false);
  };

  const testConn = async () => {
    setBusy(true); setErr(""); setInfo("");
    try {
      const r = await fetch(SB_URL + "/rest/v1/", {
        headers: { "apikey": SB_KEY }
      });
      setInfo("Соединение OK — статус " + r.status + ". Теперь пробуй войти.");
    } catch (e) {
      setErr("Ошибка соединения: " + e.message + " | URL: " + SB_URL);
    }
    setBusy(false);
  };

  const inputStyle = {
    width: "100%", padding: "11px 14px", background: C.surface,
    border: `1px solid ${C.border}`, borderRadius: 8, color: C.text,
    fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Georgia","Times New Roman",serif' }}>
      <div style={{ width: 340, padding: "36px 32px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ margin: "0 auto 12px", display: "flex", justifyContent: "center" }}>
            <LogoMark size={56} />
          </div>
          <div style={{ fontSize: 20, fontWeight: "normal", color: C.accent, letterSpacing: "0.04em", fontFamily: "Georgia, serif" }}>vinyldarksea</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>цифровой каталог коллекционера</div>
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
          {[["login","Войти"],["register","Регистрация"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setErr(""); setInfo(""); }}
              style={{ flex: 1, padding: "8px", background: mode===m ? C.accent : "transparent", color: mode===m ? C.bg : C.muted, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: mode===m ? "bold" : "normal" }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} onKeyDown={e => e.key === "Enter" && submit()} />
          <input type="password" placeholder="Пароль" value={pass} onChange={e => setPass(e.target.value)} style={inputStyle} onKeyDown={e => e.key === "Enter" && submit()} />
        </div>

        {err  && <div style={{ marginTop: 12, fontSize: 12, color: C.dangerText, textAlign: "center" }}>{err}</div>}
        {info && <div style={{ marginTop: 12, fontSize: 12, color: "#5aaa5a", textAlign: "center" }}>{info}</div>}

        <button onClick={submit} disabled={busy}
          style={{ width: "100%", marginTop: 16, padding: "12px", background: busy ? C.border : C.accent, color: busy ? C.muted : C.bg, border: "none", borderRadius: 8, fontSize: 14, fontFamily: "inherit", fontWeight: "bold", cursor: busy ? "not-allowed" : "pointer" }}>
          {busy ? "Подождите..." : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
        <button onClick={testConn} disabled={busy}
          style={{ width: "100%", marginTop: 8, padding: "9px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontFamily: "inherit", cursor: busy ? "not-allowed" : "pointer" }}>
          Проверить соединение с БД
        </button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function VinylCatalog() {
  const [user,    setUser]    = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab,     setTab]     = useState("catalog");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbOk,    setDbOk]    = useState(null);
  const [q,       setQ]       = useState("");
  const [filters, setFilters] = useState({ genres: [], decades: [], condition: null });
  const [sort,    setSort]    = useState("artist");
  const [detail,  setDetail]  = useState(null);
  const [profile, setProfile] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [route,   setRoute]   = useState(null); // null | {type:"public", username}

  // Hash routing
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/u\/([a-z0-9_]+)$/i);
      if (match) {
        setRoute({ type: "public", username: match[1] });
      } else {
        setRoute(null);
      }
    };
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const s = await window.storage.get("session");
        if (s?.value) {
          const sess = JSON.parse(s.value);
          _token  = sess.token;
          _userId = sess.userId;
          // Try to refresh expired token
          if (sess.refreshToken) {
            try {
              const rr = await fetch(SB_URL + "/auth/v1/token?grant_type=refresh_token", {
                method: "POST",
                headers: { "apikey": SB_KEY, "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: sess.refreshToken }),
              });
              if (rr.ok) {
                const rd = await rr.json();
                _token = rd.access_token;
                _userId = rd.user?.id;
                const ns = { ...sess, token: rd.access_token, refreshToken: rd.refresh_token, userId: rd.user?.id };
                await window.storage.set("session", JSON.stringify(ns));
                setUser(ns);
              } else { setUser(sess); }
            } catch { setUser(sess); }
          } else { setUser(sess); }
        }
      } catch {}
      setAuthLoading(false);
    };
    restoreSession();
  }, []);

  useEffect(() => {
    if (user) {
      loadAll();
      dbGetProfile(_userId).then(p => {
        setProfile(p);
        if (p && !p.display_name) setShowProfileModal(true);
      }).catch(() => {});
    }
  }, [user]);

  async function loadAll() {
    setLoading(true);
    try {
      let existing = await dbGetAll();
      setDbOk(true);

      // Новый пользователь — пустая коллекция (seed НЕ записывается в БД)
      // existing остаётся пустым массивом

      setRecords(existing.sort((a,b) => (a.artist||"").localeCompare(b.artist||"")));
    } catch (e) {
      console.error("loadAll error:", e);
      setDbOk(false);
      // Fallback to window.storage
      try {
        const res = await window.storage.list("vin:");
        if (res?.keys?.length) {
          const all = (await Promise.all(res.keys.map(async k => {
            try { const r = await window.storage.get(k); return r ? JSON.parse(r.value) : null; } catch { return null; }
          }))).filter(Boolean);
          setRecords(all.sort((a,b) => (a.artist||"").localeCompare(b.artist||"")));
        } else {
          setRecords(SEED);
        }
      } catch {}
    }
    setLoading(false);
  }

  const updateRecord = rec => {
    setRecords(p => p.map(r => r.id === rec.id ? rec : r));
    if (detail?.id === rec.id) setDetail(rec);
    dbSave(rec).catch(() => window.storage.set(rec.id, JSON.stringify(rec)).catch(()=>{}));
  };

  const deleteRecord = async rec => {
    try { await dbDelete(rec.id); } catch {}
    try { await window.storage.delete(rec.id); } catch {}
    setRecords(p => p.filter(r => r.id !== rec.id));
    setDetail(null);
  };

  const applyFilters = (list) => {
    let r = list;
    if (q.trim()) {
      const lq = q.toLowerCase();
      r = r.filter(x => x.artist?.toLowerCase().includes(lq) || x.album?.toLowerCase().includes(lq) ||
        x.genre?.toLowerCase().includes(lq) || x.year?.includes(lq) ||
        x.label?.toLowerCase().includes(lq) || x.tracks?.some(t => t.title?.toLowerCase().includes(lq)));
    }
    if (filters.genres.length)    r = r.filter(x => filters.genres.includes(x.genre));
    if (filters.decades.length)   r = r.filter(x => x.year && filters.decades.includes(Math.floor(+x.year/10)*10));
    if (filters.condition)        r = r.filter(x => x.condition === filters.condition);
    return r;
  };

  const applySorting = (list) => {
    const s = [...list];
    if (sort === "artist")     return s.sort((a,b) => (a.artist||"").localeCompare(b.artist||""));
    if (sort === "date")       return s.sort((a,b) => (b.at||"").localeCompare(a.at||""));
    if (sort === "priceAsc")   return s.sort((a,b) => (a.price?.low||0) - (b.price?.low||0));
    if (sort === "priceDesc")  return s.sort((a,b) => (b.price?.high||0) - (a.price?.high||0));
    return s;
  };

  const hits = applySorting(applyFilters(records));
  const stats = [
    ["Альбомов", records.length],
    ["Треков",   records.reduce((s,r) => s+(r.tracks?.length||0), 0)],
    ["Исполнителей", new Set(records.map(r => r.artist)).size],
  ];

  const navBtn = (t, label) => (
    <button key={t} onClick={() => { setTab(t); setDetail(null); }}
      style={{ padding:"6px 16px", borderRadius:20,
        border: `1px solid ${tab===t ? C.accent : C.border}`,
        background: tab===t ? C.accent : "transparent",
        color: tab===t ? C.bg : C.muted,
        cursor: "pointer",
        fontSize: 11,
        fontFamily: C.fMono,
        letterSpacing: "0.06em",
        fontWeight: tab===t ? "500" : "normal",
        transition: "all 0.15s",
      }}>
      {label}
    </button>
  );

  // Public profile route - show without auth
  if (route?.type === "public") {
    return <PublicProfilePage username={route.username} onLogin={() => { window.location.hash = ""; setRoute(null); }} />;
  }

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.muted, fontFamily: '"Georgia",serif', fontSize: 14 }}>Загрузка...</div>
    </div>
  );

  if (!user) return (
    <LandingPage onStart={() => {
      const el = document.getElementById("auth-screen-portal");
      if (el) el.style.display = "flex";
      else {
        const div = document.createElement("div");
        div.id = "auth-screen-portal";
        div.style.cssText = "position:fixed;inset:0;z-index:999;display:flex";
        div.innerHTML = "";
        document.body.appendChild(div);
        ReactDOM.createRoot(div).render(
          React.createElement(AuthScreen, {
            onAuth: sess => {
              _token = sess.token; _userId = sess.userId;
              setUser(sess);
              document.getElementById("auth-screen-portal")?.remove();
            }
          })
        );
      }
    }} />
  );

  return (
    <div style={{ fontFamily: C.fBody, background: C.bg, minHeight: "100vh", color: C.text, position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400;1,600&family=DM+Mono:wght@300;400&family=Cormorant+Garamond:ital,wght@0,300;1,300&display=swap');
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes vinyl-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes wave-flow {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .fade-up { animation: fade-up 0.4s ease forwards; }
        .vinyl-spin { animation: vinyl-spin 2s linear infinite; }
        body::after {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 9999;
          opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          background-size: 200px 200px;
        }
        /* FAB button */
        .fab-add {
          position: fixed;
          bottom: 28px;
          right: 24px;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #C8A96E;
          color: #0D1B2A;
          border: none;
          font-size: 28px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px #C8A96E44;
          z-index: 200;
          transition: transform 0.2s cubic-bezier(.34,1.56,.64,1), box-shadow 0.2s;
        }
        .fab-add:hover {
          transform: scale(1.1) rotate(90deg);
          box-shadow: 0 6px 28px #C8A96E66;
        }
        @media (min-width: 600px) { .fab-add { display: none; } }
        @media (max-width: 599px) { .nav-add-btn { display: none !important; } }
      `}</style>
      {/* Profile modal */}
      {showProfileModal && (
        <ProfileSetupModal
          profile={profile}
          onSave={p => { setProfile(p); setShowProfileModal(false); }}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogoMark size={36} />
          <div>
            <div style={{ fontSize: 17, fontWeight: "normal", color: C.accent, letterSpacing: "0.02em", lineHeight: 1, fontFamily: C.fDisplay, fontStyle: "italic" }}>vinyldarksea</div>
            <div style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
              цифровой каталог
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: dbOk === null ? "#888" : dbOk ? "#5aaa5a" : "#e06060", display: "inline-block" }} title={dbOk === null ? "Подключение..." : dbOk ? "Supabase: подключено" : "Supabase: ошибка"} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {navBtn("catalog", `Каталог (${records.length})`)}
          {navBtn("stats",   "Статистика")}
          <span className="nav-add-btn">{navBtn("add", "+ Добавить")}</span>
          {navBtn("about",   "О проекте")}
          {navBtn("balance", "₽ Баланс")}
          {user?.email?.includes("admin") || user?.email === "bartsits_b@mail.ru" ? navBtn("admin", "⚙️ Коды") : null}
          <div style={{ width: 1, height: 20, background: C.border }} />
          <ExportButtons records={records} />
          <div style={{ width: 1, height: 20, background: C.border }} />
          {/* Profile button */}
          <button onClick={() => setShowProfileModal(true)}
            style={{ width: 32, height: 32, borderRadius: "50%", background: C.accent, color: C.bg, border: "none", cursor: "pointer", fontSize: 12, fontWeight: "bold", fontFamily: C.fDisplay, display: "flex", alignItems: "center", justifyContent: "center" }}
            title={profile ? "@" + profile.username : "Профиль"}>
            {(profile?.display_name || user?.email || "?").substring(0, 2).toUpperCase()}
          </button>
          {profile && <ShareButton username={profile.username} />}
          <button onClick={async () => { await authSignOut(); try { await window.storage.delete("session"); } catch {} setUser(null); setRecords([]); setProfile(null); }}
            style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
            Выйти
          </button>
        </div>
      </div>

      {/* Catalog */}
      {tab === "catalog" && (
        <div style={{ padding: 24 }}>
          {detail ? (
            <DetailView record={detail} onBack={() => setDetail(null)} onDelete={deleteRecord} onUpdate={updateRecord} />
          ) : (
            <>
              {records.length > 0 && (
                <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                  {stats.map(([label, val]) => (
                    <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 22px", textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: "bold", color: C.accent, lineHeight: 1 }}>{val}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{label}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginBottom: 12, position: "relative" }}>
                <span style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", color:C.muted, fontSize:15, pointerEvents:"none" }}>♪</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по исполнителю, альбому, треку..."
                  style={{ width:"100%", padding:"11px 14px 11px 38px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, fontSize:14, fontFamily:"inherit", boxSizing:"border-box", outline:"none" }} />
                {q && <button onClick={() => setQ("")} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:16, padding:0 }}>×</button>}
              </div>
              <FilterBar records={records} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} />
              <CollectionValue records={records} />
              {loading ? (
                <div style={{ textAlign:"center", padding:"70px 0", color:C.muted }}>Загрузка...</div>
              ) : hits.length === 0 ? (
                <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}>Ничего не найдено</div>
              ) : (
                <div className="fade-up">
                  {hits.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <AlbumCard key={hits[0].id} record={hits[0]} onClick={setDetail} feature={true} />
                    </div>
                  )}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))", gap:12 }}>
                    {hits.slice(1).map((r) => <AlbumCard key={r.id} record={r} onClick={setDetail} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Stats */}
      {tab === "stats" && <StatsView records={records} />}

      {/* Balance */}
      {tab === "balance" && <BalanceView onClose={() => setTab("catalog")} />}

      {/* About */}
      {tab === "about" && <AboutView />}

      {/* Admin */}
      {tab === "admin" && <AdminPanel onClose={() => setTab("catalog")} />}

      {/* FAB button (mobile) */}
      {tab !== "add" && (
        <button className="fab-add" onClick={() => setTab("add")} title="Добавить пластинку">+</button>
      )}

      {/* Add */}
      {tab === "add" && <AddView onAdded={rec => { setRecords(p => [...p, rec].sort((a,b) => (a.artist||"").localeCompare(b.artist||""))); setTab("catalog"); setDetail(rec); }} />}
    </div>
  );
}


function exportToPDF(records, setStatus) {
  try {
    setStatus("Генерирую PDF...");

    const priced = records.filter(r => r.price);
    const totalLow  = priced.reduce((s, r) => s + (adjPrice(r.price, r.condition)?.low  || 0), 0);
    const totalHigh = priced.reduce((s, r) => s + (adjPrice(r.price, r.condition)?.high || 0), 0);
    const totalTracks = records.reduce((s, r) => s + (r.tracks?.length || 0), 0);
    const date = new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" });

    const albumCards = records.map(rec => {
      const p = rec.price ? adjPrice(rec.price, rec.condition) : null;
      const cond = rec.condition ? CONDITIONS.find(c => c.key === rec.condition) : null;
      const tracks = (rec.tracks || []).slice(0, 8).map(t => t.title).join(" · ");
      const moreTracks = rec.tracks?.length > 8 ? ` +${rec.tracks.length - 8}` : "";
      const img = rec.thumbFront || rec.thumb;

      return `
        <div class="card">
          <div class="cover">${img
            ? `<img src="${img}" alt="${rec.album}" />`
            : `<div class="no-cover">♪</div>`
          }</div>
          <div class="info">
            <div class="title">${rec.album || "—"}</div>
            <div class="artist">${rec.artist || ""}</div>
            <div class="tags">${[rec.year, rec.genre, rec.label].filter(Boolean).join(" · ")}</div>
            <div class="bottom-row">
              ${cond ? `<span class="cond" style="color:${cond.color};border-color:${cond.color}44">${cond.label}</span>` : ""}
              ${p ? `<span class="price">$${p.low}–$${p.high}</span>` : ""}
            </div>
            ${tracks ? `<div class="tracks">${tracks}${moreTracks}</div>` : ""}
          </div>
        </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Vinyl Archive — Каталог</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; background: #fff; color: #1a1208; }

  /* Cover page */
  .cover-page {
    width: 100%; height: 100vh; min-height: 297mm;
    background: #13100c;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    page-break-after: always; break-after: page;
  }
  .cover-line { width: 160px; height: 1px; background: #c8821e; margin: 16px 0; }
  .cover-title { font-size: 52px; font-weight: bold; color: #c8821e; letter-spacing: 0.12em; line-height: 1.1; text-align: center; }
  .cover-subtitle { font-size: 13px; color: #b8986a; letter-spacing: 0.08em; }
  .cover-stats { margin-top: 28px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .cover-stat { font-size: 12px; color: #8a7454; }
  .cover-stat strong { color: #d4aa70; margin-left: 6px; }
  .cover-date { position: absolute; bottom: 40px; font-size: 11px; color: #5a4a34; }

  /* Catalog pages */
  .page-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 20px 8px; border-bottom: 1px solid #c8821e;
    margin-bottom: 16px;
  }
  .page-header-title { font-size: 13px; font-weight: bold; color: #c8821e; letter-spacing: 0.1em; }
  .page-header-date { font-size: 9px; color: #9a8464; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 0 20px 20px; }

  .card {
    border: 0.5px solid #d4c4a0; border-radius: 6px; overflow: hidden;
    background: #faf8f3; break-inside: avoid;
  }
  .cover { width: 100%; aspect-ratio: 1; overflow: hidden; background: #ede8de; }
  .cover img { width: 100%; height: 100%; object-fit: contain; background: #0a0806; display: block; }
  .no-cover { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 36px; color: #c8b898; }
  .info { padding: 8px 10px 10px; border-top: 1.5px solid #c8821e; }
  .title { font-size: 11px; font-weight: bold; color: #1a1208; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
  .artist { font-size: 10px; color: #c8821e; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tags { font-size: 8.5px; color: #7a6a50; margin-bottom: 5px; }
  .bottom-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .cond { font-size: 8px; font-weight: bold; border: 0.5px solid; border-radius: 3px; padding: 1px 5px; }
  .price { font-size: 10px; font-weight: bold; color: #3a9a3a; }
  .tracks { font-size: 7.5px; color: #9a8a70; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

  @media print {
    @page { size: A4; margin: 0; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cover-page { height: 100vh; }
  }
</style>
</head>
<body>
  <div class="cover-page">
    <div class="cover-title">VINYL<br>ARCHIVE</div>
    <div class="cover-line"></div>
    <div class="cover-subtitle">Каталог виниловой коллекции</div>
    <div class="cover-stats">
      <div class="cover-stat">${records.length} альбомов <strong>·</strong> ${totalTracks} треков</div>
      <div class="cover-stat">${new Set(records.map(r => r.artist)).size} исполнителей</div>
      ${totalLow > 0 ? '<div class="cover-stat">Стоимость: <strong>$' + totalLow.toLocaleString() + '–$' + totalHigh.toLocaleString() + ' USD</strong></div>' : ""}
    </div>
    <div class="cover-date">${date}</div>
  </div>

  <div class="page-header">
    <div class="page-header-title">VINYL ARCHIVE</div>
    <div class="page-header-date">${date}</div>
  </div>
  <div class="grid">${albumCards}</div>

  <script>window.onload = () => { setTimeout(() => window.print(), 500); }<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      // fallback: download HTML
      const a = document.createElement("a");
      a.href = url; a.download = "vinyl-catalog.html"; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus(null);
  } catch (e) {
    setStatus("error:" + (e.message || "неизвестная ошибка"));
  }
}




