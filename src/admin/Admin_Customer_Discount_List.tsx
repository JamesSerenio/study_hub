// src/pages/Admin_Customer_Discount_List.tsx
// ✅ SAME classnames as Customer_Lists.tsx (one CSS)
// ✅ Full code + Export to Excel (.xlsx) by selected date
// ✅ strict TS (NO "any")
// ✅ ADD Phone # in table + receipt + excel
// ✅ Refresh button (reload list)
// ✅ Payment modal is FREE INPUTS (Cash & GCash can exceed due)
// ✅ Action "Delete" replaced with "Cancel"
// ✅ NEW: Show Attendance records (promo_attendance) per booking
// ✅ NEW: Admin can edit attempts + validity_end_at per booking
// ✅ FIX: removed `void tick` hack; totals/status auto-refresh every 10s using tick properly

import React, { useEffect, useMemo, useState } from "react";
import { IonContent, IonPage } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";
import logo from "../assets/study_hub.png";

import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";
type DiscountKind = "none" | "percent" | "amount";

type AttendanceAction = "in" | "out";

type PromoAttendanceRow = {
  id: string;
  created_at: string;
  promo_booking_id: string;
  promo_code: string;
  action: AttendanceAction;
  staff_id: string | null;
  note: string | null;
};

interface PromoBookingRow {
  id: string;
  created_at: string;
  full_name: string;
  phone_number: string | null;

  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean;
  paid_at: string | null;

  discount_kind: DiscountKind;
  discount_value: number;
  discount_reason: string | null;

  // ✅ NEW
  promo_code: string | null;
  attempts: number; // remaining attempts (admin controlled)
  validity_end_at: string | null;

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

interface PromoBookingDBRow {
  id: string;
  created_at: string;
  full_name: string;
  phone_number: string | null;

  area: PackageArea;
  seat_number: string | null;
  start_at: string;
  end_at: string;
  price: number | string | null;

  gcash_amount: number | string | null;
  cash_amount: number | string | null;
  is_paid: boolean | number | string | null;
  paid_at: string | null;

  discount_kind: DiscountKind | string | null;
  discount_value: number | string | null;
  discount_reason: string | null;

  // ✅ NEW
  promo_code?: string | null;
  attempts?: number | string | null;
  validity_end_at?: string | null;

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

interface PromoBookingPaidUpdateRow {
  id: string;
  is_paid: boolean | number | string | null;
  paid_at: string | null;
  gcash_amount: number | string | null;
  cash_amount: number | string | null;
}

/* ================= HELPERS ================= */

const toNumber = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const round2 = (n: number): number => Number((Number.isFinite(n) ? n : 0).toFixed(2));

const toBool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "paid";
  }
  return false;
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const yyyyMmDdLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getCreatedDateLocal = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return yyyyMmDdLocal(d);
};

const startEndIsoLocalDay = (yyyyMmDd: string): { startIso: string; endIso: string } => {
  const [yStr, mStr, dStr] = yyyyMmDd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  const startLocal = new Date(y, m - 1, d, 0, 0, 0, 0);
  const endLocal = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

  return { startIso: startLocal.toISOString(), endIso: endLocal.toISOString() };
};

const prettyArea = (a: PackageArea): string => (a === "conference_room" ? "Conference Room" : "Common Area");

const seatLabel = (r: PromoBookingRow): string =>
  r.area === "conference_room" ? "CONFERENCE ROOM" : r.seat_number || "N/A";

const safePhone = (v: string | null | undefined): string => (String(v ?? "").trim() ? String(v ?? "").trim() : "—");

// ✅ FIXED: accepts nowMs (we'll pass tick)
const getStatus = (
  startIso: string,
  endIso: string,
  nowMs: number = Date.now()
): "UPCOMING" | "ONGOING" | "FINISHED" => {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();

  if (!Number.isFinite(s) || !Number.isFinite(e)) return "FINISHED";
  if (nowMs < s) return "UPCOMING";
  if (nowMs >= s && nowMs <= e) return "ONGOING";
  return "FINISHED";
};

const formatDuration = (v: number, u: DurationUnit): string => {
  const unit =
    u === "hour"
      ? v === 1
        ? "hour"
        : "hours"
      : u === "day"
      ? v === 1
        ? "day"
        : "days"
      : u === "month"
      ? v === 1
        ? "month"
        : "months"
      : v === 1
      ? "year"
      : "years";
  return `${v} ${unit}`;
};

const normalizeDiscountKind = (v: unknown): DiscountKind => {
  const s = String(v ?? "none").trim().toLowerCase();
  if (s === "percent") return "percent";
  if (s === "amount") return "amount";
  return "none";
};

const getDiscountTextFrom = (kind: DiscountKind, value: number): string => {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (kind === "percent" && v > 0) return `${v}%`;
  if (kind === "amount" && v > 0) return `₱${v.toFixed(2)}`;
  return "—";
};

const applyDiscount = (
  baseCost: number,
  kind: DiscountKind,
  value: number
): { discountedCost: number; discountAmount: number } => {
  const cost = Number.isFinite(baseCost) ? Math.max(0, baseCost) : 0;
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;

  if (kind === "percent") {
    const pct = clamp(v, 0, 100);
    const disc = round2((cost * pct) / 100);
    const final = round2(Math.max(0, cost - disc));
    return { discountedCost: final, discountAmount: disc };
  }

  if (kind === "amount") {
    const disc = round2(Math.min(cost, v));
    const final = round2(Math.max(0, cost - disc));
    return { discountedCost: final, discountAmount: disc };
  }

  return { discountedCost: round2(cost), discountAmount: 0 };
};

const moneyFromStr = (s: string): number => round2(Math.max(0, toNumber(s)));

const isoToLocalDateTimeInput = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const localDateTimeInputToIso = (v: string): string => new Date(v).toISOString();

const isExpired = (validityEndAtIso: string | null): boolean => {
  const iso = String(validityEndAtIso ?? "").trim();
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() > t;
};

const normalizeRow = (row: PromoBookingDBRow): PromoBookingRow => {
  const kind = normalizeDiscountKind(row.discount_kind);
  const value = round2(toNumber(row.discount_value));

  const attempts = Math.max(0, Math.floor(toNumber(row.attempts ?? 0)));
  const validity_end_at = row.validity_end_at ?? null;

  return {
    id: row.id,
    created_at: row.created_at,
    full_name: row.full_name,
    phone_number: row.phone_number ?? null,

    area: row.area,
    seat_number: row.seat_number,
    start_at: row.start_at,
    end_at: row.end_at,
    price: round2(toNumber(row.price)),

    gcash_amount: round2(toNumber(row.gcash_amount)),
    cash_amount: round2(toNumber(row.cash_amount)),
    is_paid: toBool(row.is_paid),
    paid_at: row.paid_at ?? null,

    discount_kind: kind,
    discount_value: value,
    discount_reason: row.discount_reason ?? null,

    promo_code: (row.promo_code ?? null) ? String(row.promo_code ?? "").trim() : null,
    attempts,
    validity_end_at,

    packages: row.packages ?? null,
    package_options: row.package_options ?? null,
  };
};

/* ================= Excel helpers ================= */

const isLikelyUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v.trim());

const fetchAsArrayBuffer = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
};

const Admin_Customer_Discount_List: React.FC = () => {
  const [rows, setRows] = useState<PromoBookingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selected, setSelected] = useState<PromoBookingRow | null>(null);

  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [tick, setTick] = useState<number>(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 10000);
    return () => window.clearInterval(t);
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(yyyyMmDdLocal(new Date()));
  const [deletingDate, setDeletingDate] = useState<string | null>(null);

  // payment modal
  const [paymentTarget, setPaymentTarget] = useState<PromoBookingRow | null>(null);
  const [gcashInput, setGcashInput] = useState<string>("0");
  const [cashInput, setCashInput] = useState<string>("0");
  const [savingPayment, setSavingPayment] = useState<boolean>(false);

  // discount modal
  const [discountTarget, setDiscountTarget] = useState<PromoBookingRow | null>(null);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountValueInput, setDiscountValueInput] = useState<string>("0");
  const [discountReasonInput, setDiscountReasonInput] = useState<string>("");
  const [savingDiscount, setSavingDiscount] = useState<boolean>(false);

  // paid toggle
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);

  // CANCEL modal
  const [cancelTarget, setCancelTarget] = useState<PromoBookingRow | null>(null);
  const [cancelDesc, setCancelDesc] = useState<string>("");
  const [cancelError, setCancelError] = useState<string>("");
  const [cancelling, setCancelling] = useState<boolean>(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // ✅ Attendance map + modals
  const [attMap, setAttMap] = useState<Record<string, PromoAttendanceRow[]>>({});
  const [attModalTarget, setAttModalTarget] = useState<PromoBookingRow | null>(null);

  // ✅ Admin edit attempts/validity modal
  const [ruleTarget, setRuleTarget] = useState<PromoBookingRow | null>(null);
  const [ruleAttemptsInput, setRuleAttemptsInput] = useState<string>("0");
  const [ruleValidityInput, setRuleValidityInput] = useState<string>(""); // datetime-local
  const [savingRule, setSavingRule] = useState<boolean>(false);

  const selectPromoBookings = `
    id,
    created_at,
    full_name,
    phone_number,
    area,
    seat_number,
    start_at,
    end_at,
    price,
    gcash_amount,
    cash_amount,
    is_paid,
    paid_at,
    discount_kind,
    discount_value,
    discount_reason,

    promo_code,
    attempts,
    validity_end_at,

    packages:package_id ( title ),
    package_options:package_option_id (
      option_name,
      duration_value,
      duration_unit
    )
  `;

  const fetchAttendanceForBookings = async (bookingIds: string[]): Promise<void> => {
    if (bookingIds.length === 0) {
      setAttMap({});
      return;
    }

    const safeIds = bookingIds.slice(0, 500);

    const { data, error } = await supabase
      .from("promo_attendance")
      .select("id, created_at, promo_booking_id, promo_code, action, staff_id, note")
      .in("promo_booking_id", safeIds)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (error) {
      setAttMap({});
      return;
    }

    const aRows = (data ?? []) as PromoAttendanceRow[];
    const map: Record<string, PromoAttendanceRow[]> = {};
    for (const r of aRows) {
      const k = String(r.promo_booking_id);
      if (!map[k]) map[k] = [];
      map[k].push(r);
    }

    Object.keys(map).forEach((k) => {
      map[k] = map[k].slice(0, 20);
    });

    setAttMap(map);
  };

  const fetchPromoBookings = async (): Promise<void> => {
    setLoading(true);

    const { data, error } = await supabase.from("promo_bookings").select(selectPromoBookings).order("created_at", {
      ascending: false,
    });

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      alert(`Load error: ${error.message}`);
      setRows([]);
      setAttMap({});
      setLoading(false);
      return;
    }

    const dbRows = (data ?? []) as unknown as PromoBookingDBRow[];
    const normalized = dbRows.map(normalizeRow);

    setRows(normalized);
    setLoading(false);

    const ids = normalized.map((r) => r.id);
    void fetchAttendanceForBookings(ids);
  };

  const refreshAll = async (): Promise<void> => {
    try {
      setRefreshing(true);
      await fetchPromoBookings();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchPromoBookings();
  }, []);

  // ✅ FIX: no `void tick` here
  const filteredRows = useMemo(() => {
    return rows.filter((r) => getCreatedDateLocal(r.created_at) === selectedDate);
  }, [rows, selectedDate]);

  // ✅ FIX: totals uses tick properly (recompute every 10s)
  const totals = useMemo(() => {
    const nowMs = tick;

    const total = filteredRows.reduce((sum, r) => sum + toNumber(r.price), 0);

    let upcoming = 0;
    let ongoing = 0;
    let finished = 0;

    for (const r of filteredRows) {
      const st = getStatus(r.start_at, r.end_at, nowMs);
      if (st === "UPCOMING") upcoming += 1;
      else if (st === "ONGOING") ongoing += 1;
      else finished += 1;
    }

    return { total, upcoming, ongoing, finished };
  }, [filteredRows, tick]);

  const getPaidInfo = (r: PromoBookingRow): { gcash: number; cash: number; totalPaid: number } => {
    const gcash = round2(Math.max(0, toNumber(r.gcash_amount)));
    const cash = round2(Math.max(0, toNumber(r.cash_amount)));
    const totalPaid = round2(gcash + cash);
    return { gcash, cash, totalPaid };
  };

  const getDueAfterDiscount = (r: PromoBookingRow): { due: number; discountAmount: number } => {
    const base = round2(Math.max(0, toNumber(r.price)));
    const calc = applyDiscount(base, r.discount_kind, r.discount_value);
    return { due: round2(calc.discountedCost), discountAmount: round2(calc.discountAmount) };
  };

  /* =========================
     Export Excel
  ========================= */
  const exportToExcelByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date.");
      return;
    }
    if (filteredRows.length === 0) {
      alert("No records for selected date.");
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Me Tyme Lounge";
    wb.created = new Date();

    const ws = wb.addWorksheet("Promo Discounts", {
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    ws.columns = [
      { header: "Created At", key: "created_at", width: 20 },
      { header: "Customer", key: "customer", width: 26 },
      { header: "Phone #", key: "phone", width: 16 },
      { header: "Area", key: "area", width: 16 },
      { header: "Seat", key: "seat", width: 16 },
      { header: "Package", key: "pkg", width: 20 },
      { header: "Option", key: "opt", width: 28 },
      { header: "Start", key: "start", width: 20 },
      { header: "End", key: "end", width: 20 },
      { header: "Final Cost", key: "final", width: 12 },
      { header: "GCash", key: "gcash", width: 12 },
      { header: "Cash", key: "cash", width: 12 },
      { header: "Total Paid", key: "paid", width: 12 },
      { header: "Remaining", key: "remain", width: 12 },
      { header: "Paid?", key: "paid_status", width: 10 },
      { header: "Status", key: "status", width: 12 },
      { header: "Promo Code", key: "code", width: 14 },
      { header: "Attempts", key: "attempts", width: 10 },
      { header: "Validity End", key: "validity", width: 20 },
    ];

    ws.mergeCells("A1", "S1");
    ws.getCell("A1").value = "ME TYME LOUNGE — DISCOUNT / PROMO REPORT";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(1).height = 26;

    ws.mergeCells("A2", "S2");
    ws.getCell("A2").value = `Date: ${selectedDate}`;
    ws.getCell("A2").font = { size: 11 };
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

    ws.getRow(5).height = 6;

    if (isLikelyUrl(logo)) {
      const ab = await fetchAsArrayBuffer(logo);
      if (ab) {
        const ext = logo.toLowerCase().includes(".jpg") || logo.toLowerCase().includes(".jpeg") ? "jpeg" : "png";
        const imgId = wb.addImage({ buffer: ab, extension: ext });
        ws.addImage(imgId, { tl: { col: 14.8, row: 0.2 }, ext: { width: 170, height: 60 } });
      }
    }

    const headerRowIndex = 6;
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.values = ws.columns.map((c) => String(c.header ?? ""));
    headerRow.height = 20;

    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.border = {
        top: { style: "thin", color: { argb: "FF9CA3AF" } },
        left: { style: "thin", color: { argb: "FF9CA3AF" } },
        bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
        right: { style: "thin", color: { argb: "FF9CA3AF" } },
      };
    });

    filteredRows.forEach((r, idx) => {
      const opt = r.package_options;
      const optionText =
        opt?.option_name && opt?.duration_value && opt?.duration_unit
          ? `${opt.option_name} • ${formatDuration(Number(opt.duration_value), opt.duration_unit)}`
          : opt?.option_name || "—";

      const { due } = getDueAfterDiscount(r);
      const pi = getPaidInfo(r);
      const remaining = round2(Math.max(0, due - pi.totalPaid));

      const row = ws.addRow({
        created_at: new Date(r.created_at).toLocaleString("en-PH"),
        customer: r.full_name,
        phone: safePhone(r.phone_number),
        area: prettyArea(r.area),
        seat: seatLabel(r),
        pkg: r.packages?.title || "—",
        opt: optionText,
        start: new Date(r.start_at).toLocaleString("en-PH"),
        end: new Date(r.end_at).toLocaleString("en-PH"),
        final: due,
        gcash: pi.gcash,
        cash: pi.cash,
        paid: pi.totalPaid,
        remain: remaining,
        paid_status: toBool(r.is_paid) ? "PAID" : "UNPAID",
        status: getStatus(r.start_at, r.end_at, tick),
        code: r.promo_code || "—",
        attempts: r.attempts,
        validity: r.validity_end_at ? new Date(r.validity_end_at).toLocaleString("en-PH") : "—",
      });

      const rowIndex = row.number;
      ws.getRow(rowIndex).height = 18;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
        const zebra = idx % 2 === 0 ? "FFFFFFFF" : "FFF9FAFB";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
    });

    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: ws.columns.length },
    };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, `admin_promo_records_${selectedDate}.xlsx`);
  };

  /* ================= PAYMENT ================= */

  const openPaymentModal = (r: PromoBookingRow): void => {
    setPaymentTarget(r);
    setGcashInput(String(round2(Math.max(0, toNumber(r.gcash_amount)))));
    setCashInput(String(round2(Math.max(0, toNumber(r.cash_amount)))));
  };

  const savePayment = async (): Promise<void> => {
    if (!paymentTarget) return;

    const base = round2(Math.max(0, toNumber(paymentTarget.price)));
    const calc = applyDiscount(base, paymentTarget.discount_kind, paymentTarget.discount_value);
    const due = round2(calc.discountedCost);

    const g = moneyFromStr(gcashInput);
    const c = moneyFromStr(cashInput);
    const totalPaid = round2(g + c);
    const isPaidAuto = due <= 0 ? true : totalPaid >= due;

    try {
      setSavingPayment(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          gcash_amount: g,
          cash_amount: c,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", paymentTarget.id)
        .select(selectPromoBookings)
        .single();

      if (error || !data) {
        alert(`Save payment error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updated = normalizeRow(data as unknown as PromoBookingDBRow);
      setRows((prev) => prev.map((x) => (x.id === paymentTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === paymentTarget.id ? updated : prev));
      setPaymentTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save payment failed.");
    } finally {
      setSavingPayment(false);
    }
  };

  /* ================= DISCOUNT ================= */

  const openDiscountModal = (r: PromoBookingRow): void => {
    setDiscountTarget(r);
    setDiscountKind(r.discount_kind ?? "none");
    setDiscountValueInput(String(round2(toNumber(r.discount_value))));
    setDiscountReasonInput(String(r.discount_reason ?? ""));
    setGcashInput(String(round2(Math.max(0, toNumber(r.gcash_amount)))));
    setCashInput(String(round2(Math.max(0, toNumber(r.cash_amount)))));
  };

  const saveDiscount = async (): Promise<void> => {
    if (!discountTarget) return;

    const base = round2(Math.max(0, toNumber(discountTarget.price)));

    const rawVal = toNumber(discountValueInput);
    const cleanVal = round2(Math.max(0, rawVal));
    const finalVal = discountKind === "percent" ? clamp(cleanVal, 0, 100) : cleanVal;

    const calc = applyDiscount(base, discountKind, finalVal);
    const newDue = round2(calc.discountedCost);

    const g = moneyFromStr(gcashInput);
    const c = moneyFromStr(cashInput);
    const totalPaid = round2(g + c);

    const isPaidAuto = newDue <= 0 ? true : totalPaid >= newDue;

    try {
      setSavingDiscount(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          discount_kind: discountKind,
          discount_value: finalVal,
          discount_reason: discountReasonInput.trim() || null,

          gcash_amount: g,
          cash_amount: c,
          is_paid: isPaidAuto,
          paid_at: isPaidAuto ? new Date().toISOString() : null,
        })
        .eq("id", discountTarget.id)
        .select(selectPromoBookings)
        .single();

      if (error || !data) {
        alert(`Save discount error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updated = normalizeRow(data as unknown as PromoBookingDBRow);
      setRows((prev) => prev.map((x) => (x.id === discountTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === discountTarget.id ? updated : prev));
      setDiscountTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save discount failed.");
    } finally {
      setSavingDiscount(false);
    }
  };

  const togglePaid = async (r: PromoBookingRow): Promise<void> => {
    try {
      setTogglingPaidId(r.id);

      const nextPaid = !toBool(r.is_paid);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          is_paid: nextPaid,
          paid_at: nextPaid ? new Date().toISOString() : null,
        })
        .eq("id", r.id)
        .select("id, is_paid, paid_at, gcash_amount, cash_amount")
        .single();

      if (error || !data) {
        alert(`Toggle paid error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const u = data as unknown as PromoBookingPaidUpdateRow;

      setRows((prev) =>
        prev.map((x) =>
          x.id === r.id
            ? {
                ...x,
                is_paid: toBool(u.is_paid),
                paid_at: u.paid_at ?? null,
                gcash_amount: round2(toNumber(u.gcash_amount)),
                cash_amount: round2(toNumber(u.cash_amount)),
              }
            : x
        )
      );

      setSelected((prev) =>
        prev?.id === r.id
          ? {
              ...prev,
              is_paid: toBool(u.is_paid),
              paid_at: u.paid_at ?? null,
              gcash_amount: round2(toNumber(u.gcash_amount)),
              cash_amount: round2(toNumber(u.cash_amount)),
            }
          : prev
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Toggle paid failed.");
    } finally {
      setTogglingPaidId(null);
    }
  };

  /* ================= CANCEL ================= */

  const openCancelModal = (r: PromoBookingRow): void => {
    setCancelTarget(r);
    setCancelDesc("");
    setCancelError("");
  };

  const runCancel = async (): Promise<void> => {
    if (!cancelTarget) return;

    const desc = cancelDesc.trim();
    if (!desc) {
      setCancelError("Description / reason is required.");
      return;
    }

    try {
      setCancelling(true);
      setCancellingId(cancelTarget.id);
      setCancelError("");

      const { data: fullRow, error: fullErr } = await supabase
        .from("promo_bookings")
        .select(
          `
          id,
          created_at,
          user_id,
          full_name,
          phone_number,
          area,
          package_id,
          package_option_id,
          seat_number,
          start_at,
          end_at,
          price,
          status,
          gcash_amount,
          cash_amount,
          is_paid,
          paid_at,
          discount_reason,
          discount_kind,
          discount_value,
          promo_code,
          attempts,
          validity_end_at
        `
        )
        .eq("id", cancelTarget.id)
        .single();

      if (fullErr || !fullRow) {
        setCancelError(`Failed to load booking: ${fullErr?.message ?? "Unknown error"}`);
        return;
      }

      const { error: insErr } = await supabase.from("promo_bookings_cancelled").insert({
        original_id: fullRow.id,
        description: desc,

        created_at: fullRow.created_at,
        user_id: fullRow.user_id ?? null,
        full_name: fullRow.full_name,
        phone_number: fullRow.phone_number ?? null,

        area: fullRow.area,
        package_id: fullRow.package_id,
        package_option_id: fullRow.package_option_id,

        seat_number: fullRow.seat_number ?? null,
        start_at: fullRow.start_at,
        end_at: fullRow.end_at,

        price: fullRow.price ?? 0,
        status: fullRow.status ?? "pending",

        gcash_amount: fullRow.gcash_amount ?? 0,
        cash_amount: fullRow.cash_amount ?? 0,
        is_paid: Boolean(fullRow.is_paid),
        paid_at: fullRow.paid_at ?? null,

        discount_reason: fullRow.discount_reason ?? null,
        discount_kind: String(fullRow.discount_kind ?? "none"),
        discount_value: fullRow.discount_value ?? 0,

        promo_code: fullRow.promo_code ?? null,
        attempts: Number(fullRow.attempts ?? 0) || 0,
        validity_end_at: fullRow.validity_end_at ?? null,
      });

      if (insErr) {
        setCancelError(`Cancel save failed: ${insErr.message}`);
        return;
      }

      const { error: delErr } = await supabase.from("promo_bookings").delete().eq("id", cancelTarget.id);
      if (delErr) {
        setCancelError(
          `Inserted to cancelled, but delete failed: ${delErr.message}. (You may now have duplicate if you retry.)`
        );
        return;
      }

      setRows((prev) => prev.filter((x) => x.id !== cancelTarget.id));
      setSelected((prev) => (prev?.id === cancelTarget.id ? null : prev));
      setCancelTarget(null);

      setAttMap((prev) => {
        const next = { ...prev };
        delete next[cancelTarget.id];
        return next;
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      setCancelError("Cancel failed (unexpected error).");
    } finally {
      setCancelling(false);
      setCancellingId(null);
    }
  };

  const deleteByDate = async (): Promise<void> => {
    if (!selectedDate) {
      alert("Please select a date first.");
      return;
    }

    const count = filteredRows.length;
    const ok = window.confirm(`Delete ALL promo records on ${selectedDate}?\n\nThis will delete ${count} record(s).`);
    if (!ok) return;

    const range = startEndIsoLocalDay(selectedDate);

    try {
      setDeletingDate(selectedDate);

      const { error } = await supabase
        .from("promo_bookings")
        .delete()
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso);

      if (error) {
        alert(`Delete by date error: ${error.message}`);
        return;
      }

      setRows((prev) => prev.filter((r) => getCreatedDateLocal(r.created_at) !== selectedDate));
      setSelected((prev) => (prev && getCreatedDateLocal(prev.created_at) === selectedDate ? null : prev));
      setAttMap({});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Delete by date failed.");
    } finally {
      setDeletingDate(null);
    }
  };

  /* ================= Attendance UI helpers ================= */

  const logsFor = (bookingId: string): PromoAttendanceRow[] => attMap[bookingId] ?? [];

  const lastLogFor = (bookingId: string): PromoAttendanceRow | null => {
    const logs = logsFor(bookingId);
    return logs.length ? logs[0] : null;
  };

  /* ================= Admin edit attempts/validity ================= */

  const openRuleModal = (r: PromoBookingRow): void => {
    setRuleTarget(r);
    setRuleAttemptsInput(String(Math.max(0, Math.floor(toNumber(r.attempts)))));
    setRuleValidityInput(r.validity_end_at ? isoToLocalDateTimeInput(r.validity_end_at) : "");
  };

  const saveRule = async (): Promise<void> => {
    if (!ruleTarget) return;

    const attempts = Math.max(0, Math.floor(toNumber(ruleAttemptsInput)));
    const validityIso = ruleValidityInput.trim() ? localDateTimeInputToIso(ruleValidityInput.trim()) : null;

    try {
      setSavingRule(true);

      const { data, error } = await supabase
        .from("promo_bookings")
        .update({
          attempts,
          validity_end_at: validityIso,
        })
        .eq("id", ruleTarget.id)
        .select(selectPromoBookings)
        .single();

      if (error || !data) {
        alert(`Save rule error: ${error?.message ?? "Unknown error"}`);
        return;
      }

      const updated = normalizeRow(data as unknown as PromoBookingDBRow);
      setRows((prev) => prev.map((x) => (x.id === ruleTarget.id ? updated : x)));
      setSelected((prev) => (prev?.id === ruleTarget.id ? updated : prev));
      setRuleTarget(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      alert("Save rule failed.");
    } finally {
      setSavingRule(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="staff-content">
        <div className="customer-lists-container">
          <div className="customer-topbar">
            <div className="customer-topbar-left">
              <h2 className="customer-lists-title">Admin Discount / Promo Records</h2>
              <div className="customer-subtext">
                Showing records for: <strong>{selectedDate}</strong>
              </div>

              {/* OPTIONAL: show totals (if you want to display) */}
              <div className="customer-subtext" style={{ marginTop: 6 }}>
                Total: <strong>₱{round2(totals.total).toFixed(2)}</strong> • Upcoming: <strong>{totals.upcoming}</strong> •
                Ongoing: <strong>{totals.ongoing}</strong> • Finished: <strong>{totals.finished}</strong>
              </div>
            </div>

            <div className="customer-topbar-right">
              <label className="date-pill">
                <span className="date-pill-label">Date</span>
                <input
                  className="date-pill-input"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(String(e.currentTarget.value ?? ""))}
                />
                <span className="date-pill-icon" aria-hidden="true">
                  📅
                </span>
              </label>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="receipt-btn" onClick={() => void refreshAll()} disabled={loading || refreshing}>
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>

                <button className="receipt-btn" onClick={() => void exportToExcelByDate()} disabled={filteredRows.length === 0}>
                  Export to Excel
                </button>

                <button className="receipt-btn" onClick={() => void deleteByDate()} disabled={deletingDate === selectedDate}>
                  {deletingDate === selectedDate ? "Deleting Date..." : "Delete by Date"}
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="customer-note">Loading...</p>
          ) : filteredRows.length === 0 ? (
            <p className="customer-note">No promo records found for this date</p>
          ) : (
            <div className="customer-table-wrap" key={selectedDate}>
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Area</th>
                    <th>Seat</th>
                    <th>Package</th>
                    <th>Option</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Price</th>
                    <th>Discount</th>
                    <th>Status</th>
                    <th>Paid?</th>
                    <th>Payment</th>
                    <th>Code / Rules</th>
                    <th>Attendance</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((r) => {
                    const opt = r.package_options;

                    const optionText =
                      opt?.option_name && opt?.duration_value && opt?.duration_unit
                        ? `${opt.option_name} • ${formatDuration(Number(opt.duration_value), opt.duration_unit)}`
                        : opt?.option_name || "—";

                    const paid = toBool(r.is_paid);

                    const { due, discountAmount } = getDueAfterDiscount(r);

                    const pi = getPaidInfo(r);
                    const remaining = round2(Math.max(0, due - pi.totalPaid));

                    const last = lastLogFor(r.id);

                    return (
                      <tr key={r.id}>
                        <td>{new Date(r.created_at).toLocaleString("en-PH")}</td>
                        <td>{r.full_name}</td>
                        <td>{safePhone(r.phone_number)}</td>
                        <td>{prettyArea(r.area)}</td>
                        <td>{seatLabel(r)}</td>
                        <td>{r.packages?.title || "—"}</td>
                        <td>{optionText}</td>
                        <td>{new Date(r.start_at).toLocaleString("en-PH")}</td>
                        <td>{new Date(r.end_at).toLocaleString("en-PH")}</td>

                        <td>₱{due.toFixed(2)}</td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{getDiscountTextFrom(r.discount_kind, r.discount_value)}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>Disc ₱{discountAmount.toFixed(2)}</span>
                            <button className="receipt-btn" onClick={() => openDiscountModal(r)}>
                              Discount
                            </button>
                          </div>
                        </td>

                        <td>
                          <strong>{getStatus(r.start_at, r.end_at, tick)}</strong>
                        </td>

                        <td>
                          <button
                            className={`receipt-btn pay-badge ${paid ? "pay-badge--paid" : "pay-badge--unpaid"}`}
                            onClick={() => void togglePaid(r)}
                            disabled={togglingPaidId === r.id}
                            title={paid ? "Tap to set UNPAID" : "Tap to set PAID"}
                          >
                            {togglingPaidId === r.id ? "Updating..." : paid ? "PAID" : "UNPAID"}
                          </button>
                        </td>

                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">
                              GCash ₱{pi.gcash.toFixed(2)} / Cash ₱{pi.cash.toFixed(2)}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>Remaining ₱{remaining.toFixed(2)}</span>
                            <button className="receipt-btn" onClick={() => openPaymentModal(r)} disabled={due <= 0}>
                              Payment
                            </button>
                          </div>
                        </td>

                        {/* ✅ Code/attempts/validity */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{r.promo_code || "—"}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              Attempts: <b>{r.attempts}</b>
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              Validity:{" "}
                              <b>{r.validity_end_at ? new Date(r.validity_end_at).toLocaleString("en-PH") : "—"}</b>{" "}
                              {r.validity_end_at && isExpired(r.validity_end_at) ? (
                                <span style={{ marginLeft: 6, color: "#b00020", fontWeight: 900 }}>EXPIRED</span>
                              ) : null}
                            </span>
                            <button className="receipt-btn" onClick={() => openRuleModal(r)}>
                              Edit
                            </button>
                          </div>
                        </td>

                        {/* ✅ Attendance */}
                        <td>
                          <div className="cell-stack cell-center">
                            <span className="cell-strong">{last ? `${String(last.action).toUpperCase()}` : "—"}</span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {last ? new Date(last.created_at).toLocaleString("en-PH") : "No logs"}
                            </span>
                            <button className="receipt-btn" onClick={() => setAttModalTarget(r)}>
                              Attendance
                            </button>
                          </div>
                        </td>

                        <td>{(r.discount_reason ?? "").trim() || "—"}</td>

                        <td>
                          <div className="action-stack">
                            <button className="receipt-btn" onClick={() => setSelected(r)}>
                              View Receipt
                            </button>

                            <button
                              className="receipt-btn"
                              disabled={cancelling || cancellingId === r.id}
                              onClick={() => openCancelModal(r)}
                            >
                              {cancellingId === r.id ? "Cancelling..." : "Cancel"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ✅ ATTENDANCE MODAL (read-only) */}
          {attModalTarget && (
            <div className="receipt-overlay" onClick={() => setAttModalTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">ATTENDANCE LOGS</h3>
                <p className="receipt-subtitle">
                  {attModalTarget.full_name} • Code: <b>{attModalTarget.promo_code || "—"}</b>
                </p>

                <hr />

                <div style={{ fontWeight: 900, marginBottom: 10 }}>Recent Logs</div>

                {logsFor(attModalTarget.id).length === 0 ? (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>No attendance logs.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {logsFor(attModalTarget.id).map((h) => (
                      <div
                        key={h.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          padding: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 1000 }}>
                            {String(h.action).toUpperCase()} • {new Date(h.created_at).toLocaleString("en-PH")}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                            Code: <b>{h.promo_code}</b>
                          </div>
                          {h.note ? <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{h.note}</div> : null}
                        </div>

                        <div style={{ fontWeight: 900, opacity: 0.8, whiteSpace: "nowrap" }}>{h.staff_id ? "STAFF" : "—"}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setAttModalTarget(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ✅ ADMIN EDIT RULES MODAL */}
          {ruleTarget && (
            <div className="receipt-overlay" onClick={() => (savingRule ? null : setRuleTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">EDIT CODE RULES</h3>
                <p className="receipt-subtitle">
                  {ruleTarget.full_name} • Code: <b>{ruleTarget.promo_code || "—"}</b>
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Attempts</span>
                  <input
                    className="money-input"
                    type="number"
                    min="0"
                    step="1"
                    value={ruleAttemptsInput}
                    onChange={(e) => setRuleAttemptsInput(e.currentTarget.value)}
                    disabled={savingRule}
                    placeholder="0"
                  />
                </div>

                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>Tip: attempts = remaining uses. If you want unlimited, set to 0.</div>

                <div className="receipt-row" style={{ marginTop: 10 }}>
                  <span>Validity End</span>
                  <input
                    className="money-input"
                    type="datetime-local"
                    value={ruleValidityInput}
                    onChange={(e) => setRuleValidityInput(e.currentTarget.value)}
                    disabled={savingRule}
                  />
                </div>

                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>If blank = no expiry.</div>

                <div className="modal-actions" style={{ marginTop: 16 }}>
                  <button className="receipt-btn" onClick={() => setRuleTarget(null)} disabled={savingRule}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void saveRule()} disabled={savingRule}>
                    {savingRule ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* CANCEL MODAL */}
          {cancelTarget && (
            <div className="receipt-overlay" onClick={() => (cancelling ? null : setCancelTarget(null))}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">CANCEL PROMO</h3>
                <p className="receipt-subtitle">
                  {cancelTarget.full_name} • {safePhone(cancelTarget.phone_number)}
                </p>

                <hr />

                <div className="receipt-row" style={{ alignItems: "flex-start" }}>
                  <span style={{ paddingTop: 6 }}>Description</span>
                  <div style={{ width: "100%" }}>
                    <textarea
                      className="reason-input"
                      style={{ width: "100%", minHeight: 90, resize: "vertical" }}
                      value={cancelDesc}
                      onChange={(e) => setCancelDesc(e.currentTarget.value)}
                      placeholder="Required: reason / description for cancellation..."
                      disabled={cancelling}
                    />
                    {cancelError ? <div style={{ marginTop: 8, color: "#b00020", fontSize: 12 }}>{cancelError}</div> : null}
                  </div>
                </div>

                <div className="modal-actions">
                  <button className="receipt-btn" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                    Close
                  </button>
                  <button className="receipt-btn" onClick={() => void runCancel()} disabled={cancelling}>
                    {cancelling ? "Cancelling..." : "Confirm Cancel"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT MODAL */}
          {paymentTarget && (
            <div className="receipt-overlay" onClick={() => setPaymentTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">PAYMENT</h3>
                <p className="receipt-subtitle">
                  {paymentTarget.full_name} • {safePhone(paymentTarget.phone_number)}
                </p>

                <hr />

                {(() => {
                  const base = round2(Math.max(0, toNumber(paymentTarget.price)));
                  const calc = applyDiscount(base, paymentTarget.discount_kind, paymentTarget.discount_value);
                  const due = round2(calc.discountedCost);

                  const g = moneyFromStr(gcashInput);
                  const c = moneyFromStr(cashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willPaid = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <div className="receipt-row">
                        <span>Total Due</span>
                        <span>₱{due.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>GCash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={gcashInput}
                          onChange={(e) => setGcashInput(e.currentTarget.value)}
                        />
                      </div>

                      <div className="receipt-row">
                        <span>Cash</span>
                        <input
                          className="money-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={cashInput}
                          onChange={(e) => setCashInput(e.currentTarget.value)}
                        />
                      </div>

                      <hr />

                      <div className="receipt-row">
                        <span>Total Paid</span>
                        <span>₱{totalPaid.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>{isChange ? "Change" : "Remaining"}</span>
                        <span>₱{remainingAbs.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Status</span>
                        <span className="receipt-status">{willPaid ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setPaymentTarget(null)}>
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void savePayment()} disabled={savingPayment}>
                          {savingPayment ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* DISCOUNT MODAL */}
          {discountTarget && (
            <div className="receipt-overlay" onClick={() => setDiscountTarget(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <h3 className="receipt-title">DISCOUNT</h3>
                <p className="receipt-subtitle">
                  {discountTarget.full_name} • {safePhone(discountTarget.phone_number)}
                </p>

                <hr />

                <div className="receipt-row">
                  <span>Discount Type</span>
                  <select value={discountKind} onChange={(e) => setDiscountKind(e.currentTarget.value as DiscountKind)}>
                    <option value="none">None</option>
                    <option value="percent">Percent (%)</option>
                    <option value="amount">Peso (₱)</option>
                  </select>
                </div>

                <div className="receipt-row">
                  <span>Value</span>
                  <div className="inline-input">
                    <span className="inline-input-prefix">{discountKind === "percent" ? "%" : discountKind === "amount" ? "₱" : ""}</span>
                    <input
                      className="small-input"
                      type="number"
                      min="0"
                      step={discountKind === "percent" ? "1" : "0.01"}
                      value={discountValueInput}
                      onChange={(e) => setDiscountValueInput(e.currentTarget.value)}
                      disabled={discountKind === "none"}
                    />
                  </div>
                </div>

                <div className="receipt-row">
                  <span>Reason</span>
                  <input
                    className="reason-input"
                    type="text"
                    value={discountReasonInput}
                    onChange={(e) => setDiscountReasonInput(e.currentTarget.value)}
                    placeholder="e.g. loyalty card"
                  />
                </div>

                {(() => {
                  const base = round2(Math.max(0, toNumber(discountTarget.price)));
                  const rawVal = toNumber(discountValueInput);
                  const val = discountKind === "percent" ? clamp(Math.max(0, rawVal), 0, 100) : Math.max(0, rawVal);

                  const { discountedCost, discountAmount } = applyDiscount(base, discountKind, val);
                  const due = round2(discountedCost);

                  const g = moneyFromStr(gcashInput);
                  const c = moneyFromStr(cashInput);
                  const totalPaid = round2(g + c);

                  const remainingSigned = round2(due - totalPaid);
                  const isChange = remainingSigned < 0;
                  const remainingAbs = round2(Math.abs(remainingSigned));

                  const willPaid = due <= 0 ? true : totalPaid >= due;

                  return (
                    <>
                      <hr />

                      <div className="receipt-row">
                        <span>System Cost (Before)</span>
                        <span>₱{base.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount</span>
                        <span>{getDiscountTextFrom(discountKind, val)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Discount Amount</span>
                        <span>₱{discountAmount.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Final System Cost</span>
                        <span>₱{round2(due).toFixed(2)}</span>
                      </div>

                      <div className="receipt-total">
                        <span>NEW TOTAL BALANCE</span>
                        <span>₱{round2(due).toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Current Payment</span>
                        <span>
                          GCash ₱{g.toFixed(2)} / Cash ₱{c.toFixed(2)}
                        </span>
                      </div>

                      <div className="receipt-row">
                        <span>{isChange ? "Change" : "Remaining"}</span>
                        <span>₱{remainingAbs.toFixed(2)}</span>
                      </div>

                      <div className="receipt-row">
                        <span>Auto Paid</span>
                        <span className="receipt-status">{willPaid ? "PAID" : "UNPAID"}</span>
                      </div>

                      <div className="modal-actions">
                        <button className="receipt-btn" onClick={() => setDiscountTarget(null)}>
                          Cancel
                        </button>
                        <button className="receipt-btn" onClick={() => void saveDiscount()} disabled={savingDiscount}>
                          {savingDiscount ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* RECEIPT (added attendance + rules display) */}
          {selected && (
            <div className="receipt-overlay" onClick={() => setSelected(null)}>
              <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
                <img src={logo} className="receipt-logo" alt="logo" />

                <h3 className="receipt-title">ME TYME LOUNGE</h3>
                <p className="receipt-subtitle">PROMO RECEIPT</p>

                <hr />

                <div className="receipt-row">
                  <span>Status</span>
                  <span>{getStatus(selected.start_at, selected.end_at, tick)}</span>
                </div>

                <div className="receipt-row">
                  <span>Customer</span>
                  <span>{selected.full_name}</span>
                </div>

                <div className="receipt-row">
                  <span>Phone</span>
                  <span>{safePhone(selected.phone_number)}</span>
                </div>

                <div className="receipt-row">
                  <span>Promo Code</span>
                  <span style={{ fontWeight: 900 }}>{selected.promo_code || "—"}</span>
                </div>

                <div className="receipt-row">
                  <span>Attempts</span>
                  <span>{selected.attempts}</span>
                </div>

                <div className="receipt-row">
                  <span>Validity End</span>
                  <span>
                    {selected.validity_end_at ? new Date(selected.validity_end_at).toLocaleString("en-PH") : "—"}
                    {selected.validity_end_at && isExpired(selected.validity_end_at) ? (
                      <span style={{ marginLeft: 8, color: "#b00020", fontWeight: 900 }}>
                        EXPIRED
                      </span>
                    ) : null}
                  </span>
                </div>

                <hr />

                <div style={{ fontWeight: 900, marginBottom: 8 }}>Attendance Logs</div>
                {logsFor(selected.id).length === 0 ? (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>No attendance logs.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {logsFor(selected.id).slice(0, 8).map((h) => (
                      <div
                        key={h.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          padding: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 1000 }}>
                            {String(h.action).toUpperCase()} • {new Date(h.created_at).toLocaleString("en-PH")}
                          </div>
                          {h.note ? <div style={{ fontSize: 12, opacity: 0.85 }}>{h.note}</div> : null}
                        </div>
                        <div style={{ fontWeight: 900, opacity: 0.8 }}>{h.staff_id ? "STAFF" : "—"}</div>
                      </div>
                    ))}
                  </div>
                )}

                <button className="close-btn" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Customer_Discount_List;
