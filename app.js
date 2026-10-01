(() => {
  const D = window.BUS_DATA;
  const COMPANY = { I: "伊豆箱根", T: "東海バス" };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const KEY = "bus-tsugi.route";

  // テスト用：?now=2026-10-04T12:00 で時刻を固定できる
  const fixed = new URLSearchParams(location.search).get("now");
  const now = () => (fixed ? new Date(fixed) : new Date());

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  const isHolidayDiagram = (d) => d.getDay() === 0 || d.getDay() === 6 || window.HOLIDAYS.has(ymd(d));
  const kindOf = (d) => (isHolidayDiagram(d) ? "holiday" : "weekday");
  const kindLabel = (k) => (k === "holiday" ? "土日祝ダイヤ" : "平日ダイヤ");

  const parse = (s) => {
    const [dep, arr, co, label, dest] = s.split("|");
    return { dep, arr, co, label, dest, depMin: toMin(dep) };
  };
  const busesFor = (routeId, d) => D.timetable[routeId][kindOf(d)].map(parse);

  let routeId = (() => {
    try { const v = localStorage.getItem(KEY); if (v && D.timetable[v]) return v; } catch (e) {}
    return D.routes[0].id;
  })();

  const routeName = (r) => `${D.stops[r.from]}→${D.stops[r.to]}`;

  function renderRoutes() {
    const nav = document.getElementById("routes");
    nav.innerHTML = "";
    for (const r of D.routes) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = routeName(r);
      b.setAttribute("aria-pressed", String(r.id === routeId));
      b.addEventListener("click", () => {
        routeId = r.id;
        try { localStorage.setItem(KEY, routeId); } catch (e) {}
        renderRoutes();
        render();
      });
      nav.appendChild(b);
    }
  }

  // 今日の残り＋足りなければ明日の始発から、合わせて3本
  function upcoming(t) {
    const nowMin = t.getHours() * 60 + t.getMinutes();
    const today = busesFor(routeId, t).filter((b) => b.depMin >= nowMin);
    const list = today.map((b) => ({ ...b, tomorrow: false, waitMin: b.depMin - nowMin - t.getSeconds() / 60 }));
    if (list.length < 3) {
      const tm = new Date(t); tm.setDate(tm.getDate() + 1);
      for (const b of busesFor(routeId, tm)) {
        if (list.length >= 3) break;
        list.push({ ...b, tomorrow: true, waitMin: 24 * 60 - nowMin + b.depMin });
      }
    }
    return { list: list.slice(0, 3), todayLeft: today.length };
  }

  function waitText(b) {
    if (b.tomorrow) return "明日";
    const m = Math.floor(b.waitMin);
    if (m < 1) return "まもなく";
    if (m < 60) return `あと${m}分`;
    return `あと${Math.floor(m / 60)}時間${m % 60}分`;
  }

  function metaHTML(b) {
    const r = D.routes.find((x) => x.id === routeId);
    const chips = [];
    chips.push(`<span class="chip ${b.co}">${COMPANY[b.co]}${b.label && b.label !== "休校日のみ" ? " " + b.label : ""}</span>`);
    if (b.label === "休校日のみ") chips.push(`<span class="chip warn">休校日のみ運行</span>`);
    return `<div class="meta">${chips.join("")}<span>${D.stops[r.to]}着 ${b.arr}</span><span>${b.dest}行</span></div>`;
  }

  function render() {
    const t = now();
    const k = kindOf(t);
    document.getElementById("today").textContent =
      `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]}) ${kindLabel(k)}`;

    const { list, todayLeft } = upcoming(t);
    const main = document.getElementById("main");
    let html = "";
    if (todayLeft === 0) {
      html += `<div class="done">今日のバスはもう終わり</div>`;
    }
    if (list.length) {
      const [first, ...rest] = list;
      const soon = !first.tomorrow && first.waitMin < 5;
      html += `<section class="next">
        <div class="label">${first.tomorrow ? "明日の始発" : "次のバス"}</div>
        <div class="time">${first.dep}</div>
        ${first.tomorrow ? "" : `<div class="wait${soon ? " soon" : ""}">${waitText(first)}</div>`}
        ${metaHTML(first)}
      </section>`;
      html += `<div class="later">` + rest.map((b) => `<div class="row">
          <div class="time">${b.dep}</div>
          <div class="wait">${waitText(b)}</div>
          ${metaHTML(b)}
        </div>`).join("") + `</div>`;
    }
    main.innerHTML = html;
    renderAll(t);
  }

  function renderAll(t) {
    const nowMin = t.getHours() * 60 + t.getMinutes();
    const buses = busesFor(routeId, t);
    const nextDep = buses.find((b) => b.depMin >= nowMin);
    const byHour = new Map();
    for (const b of buses) {
      const h = b.dep.slice(0, 2);
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h).push(b);
    }
    let html = "";
    for (const [h, bs] of byHour) {
      html += `<div class="h">${Number(h)}時</div><div class="m">` + bs.map((b) => {
        const cls = b === nextDep ? "nx" : b.depMin < nowMin ? "past" : "";
        const note = b.label === "休校日のみ" ? "（休校日）" : "";
        return `<span class="${cls}">${b.dep.slice(3)}${note}</span>`;
      }).join("") + `</div>`;
    }
    document.getElementById("all").innerHTML = html;
    document.querySelector("#alltable summary").textContent = `今日の時刻表をぜんぶ見る（${kindLabel(kindOf(t))}）`;
  }

  document.getElementById("foot").textContent =
    `時刻表は ${D.fetched} に NAVITIME から取得。遅れ・運休は反映されない。`;

  renderRoutes();
  render();
  setInterval(render, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js");
  }
})();
