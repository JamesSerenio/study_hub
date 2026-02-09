// src/pages/Book_Add.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonButton,
  IonAlert,
  IonSpinner,
  IonModal,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonIcon,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { closeOutline } from "ionicons/icons";

import BookingModal from "../components/BookingModal";
import AddOnsModal from "../components/AddOnsModal";
import PromoModal from "../components/PromoModal";
import Seat from "../components/Seat"; // ✅ view-only seat image component

import leaves from "../assets/leave.png";
import studyHubLogo from "../assets/study_hub.png";
import whiteBear from "../assets/white_bear.png";

// ✅ receipt logo + supabase
import logo from "../assets/study_hub.png";
import { supabase } from "../utils/supabaseClient";

type SeatGroup = { title: string; seats: string[] };

const SEAT_GROUPS: SeatGroup[] = [
  { title: "1stF", seats: ["1", "2", "3", "4", "5", "6", "7a", "7b", "8a", "8b", "9", "10", "11"] },
  { title: "TATAMI AREA", seats: ["12a", "12b", "12c"] },
  { title: "2ndF", seats: ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"] },
];

// ✅ same billing constants as Customer_Lists
const HOURLY_RATE = 20;
const FREE_MINUTES = 0;

type DiscountKind = "none" | "percent" | "amount";
type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";

/* ===================== CUSTOMER VIEW (DB) ===================== */
const VIEW_STATE_TABLE = "customer_view_state";
const VIEW_STATE_ID = 1;

type CustomerViewRow = {
  id: number;
  session_id: string | null;
  enabled: boolean | number | string | null;
  updated_at: string | null;
};

/* ===================== RECEIPT TYPES ===================== */

interface CustomerSessionReceipt {
  kind: "session";

  id: string;
  date: string;
  full_name: string;
  phone_number: string | null;

  customer_type: string;
  customer_field: string | null;
  seat_number: string;

  time_started: string;
  time_ended: string;
  hour_avail: string;

  reservation: string | null;
  reservation_date: string | null;

  total_amount: number;

  down_payment: number;

  discount_kind: DiscountKind;
  discount_value: number;

  gcash_amount: number;
  cash_amount: number;
  is_paid: boolean | number | string | null;
}

interface PromoReceipt {
  kind: "promo";

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
  is_paid: boolean | number | string | null;

  discount_kind: DiscountKind;
  discount_value: number;
  discount_reason: string | null;

  packages: { title: string | null } | null;
  package_options: {
    option_name: string | null;
    duration_value: number | null;
    duration_unit: DurationUnit | null;
  } | null;
}

type ReceiptUnion = CustomerSessionReceipt | PromoReceipt;

/* ===================== HELPERS ===================== */

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const toMoney = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
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

const safePhone = (v: string | null | undefined): string => {
  const p = String(v ?? "").trim();
  return p ? p : "N/A";
};

const formatTimeText = (iso: string): string => {
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const prettyArea = (a: PackageArea): string => (a === "conference_room" ? "Conference Room" : "Common Area");

const seatLabelPromo = (r: PromoReceipt): string =>
  r.area === "conference_room" ? "CONFERENCE ROOM" : r.seat_number || "N/A";

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

const normalizeArea = (v: unknown): PackageArea => {
  const s = String(v ?? "common_area").trim().toLowerCase();
  return s === "conference_room" ? "conference_room" : "common_area";
};

const normalizeDurationUnit = (v: unknown): DurationUnit => {
  const s = String(v ?? "hour").trim().toLowerCase();
  if (s === "day") return "day";
  if (s === "month") return "month";
  if (s === "year") return "year";
  return "hour";
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

const isOpenTimeSession = (s: CustomerSessionReceipt): boolean => {
  if ((s.hour_avail || "").toUpperCase() === "OPEN") return true;
  const end = new Date(s.time_ended);
  return end.getFullYear() >= 2999;
};

const diffMinutes = (startIso: string, endIso: string): number => {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / (1000 * 60));
};

const computeCostWithFreeMinutes = (startIso: string, endIso: string): number => {
  const minutesUsed = diffMinutes(startIso, endIso);
  const chargeMinutes = Math.max(0, minutesUsed - FREE_MINUTES);
  const perMinute = HOURLY_RATE / 60;
  return round2(chargeMinutes * perMinute);
};

const getBaseSystemCost = (s: CustomerSessionReceipt): number => {
  if (isOpenTimeSession(s)) {
    const nowIso = new Date().toISOString();
    return computeCostWithFreeMinutes(s.time_started, nowIso);
  }
  return toMoney(s.total_amount);
};

// ✅ display balance/change using DB down_payment
const getDisplayAmount = (s: CustomerSessionReceipt): { label: "Total Balance" | "Total Change"; value: number } => {
  const base = getBaseSystemCost(s);
  const kind = s.discount_kind ?? "none";
  const val = toMoney(s.discount_value ?? 0);
  const disc = applyDiscount(base, kind, val);

  const dp = round2(Math.max(0, toMoney(s.down_payment ?? 0)));

  const balance = round2(Math.max(0, disc.discountedCost - dp));
  if (balance > 0) return { label: "Total Balance", value: balance };

  const change = round2(Math.max(0, dp - disc.discountedCost));
  return { label: "Total Change", value: change };
};

const isReservationSession = (s: CustomerSessionReceipt | null): boolean => {
  if (!s) return false;
  return String(s.reservation ?? "no").trim().toLowerCase() === "yes";
};

const isPromoReceipt = (r: ReceiptUnion): r is PromoReceipt => r.kind === "promo";

/* ===================== COMPONENT ===================== */

const Book_Add: React.FC = () => {
  const history = useHistory();

  // MAIN MODALS
  const [isBookingOpen, setIsBookingOpen] = useState<boolean>(false);
  const [isAddOnsOpen, setIsAddOnsOpen] = useState<boolean>(false);
  const [isPromoOpen, setIsPromoOpen] = useState<boolean>(false);

  // ✅ Seat View modal
  const [isSeatOpen, setIsSeatOpen] = useState<boolean>(false);

  // BOOKING SAVED ALERT
  const [bookingSavedOpen, setBookingSavedOpen] = useState<boolean>(false);
  const [bookingSavedMessage, setBookingSavedMessage] = useState<string>("Booking saved successfully.");

  // ADD-ONS SENT ALERT
  const [addOnsSentOpen, setAddOnsSentOpen] = useState<boolean>(false);

  // ✅ CUSTOMER VIEW (from staff) via DB
  const [customerViewEnabled, setCustomerViewEnabled] = useState<boolean>(false);
  const [customerSessionId, setCustomerSessionId] = useState<string>("");

  // ✅ receipt overlay
  const [showReceipt, setShowReceipt] = useState<boolean>(false);
  const [receiptLoading, setReceiptLoading] = useState<boolean>(false);
  const [receipt, setReceipt] = useState<ReceiptUnion | null>(null);

  // ✅ realtime channel ref (cleanup)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollRef = useRef<number | null>(null);

  // ✅ keep last good view state (prevents blinking)
  const lastGoodRef = useRef<{ enabled: boolean; sessionId: string }>({ enabled: false, sessionId: "" });

  // ✅ prevent older requests overwriting newer UI (race guard)
  const fetchSeqRef = useRef<number>(0);

  const canOpenReceipt = useMemo(
    () => customerViewEnabled && customerSessionId.length > 0,
    [customerViewEnabled, customerSessionId]
  );

  const chipText = useMemo(() => {
    return canOpenReceipt ? "Ready to view your receipt" : "Ready for booking";
  }, [canOpenReceipt]);

  /* =====================
     CUSTOMER VIEW (DB) - STABLE
  ===================== */
  const applyViewState = (enabled: boolean, sessionId: string): void => {
    setCustomerViewEnabled(enabled);
    setCustomerSessionId(sessionId);
    lastGoodRef.current = { enabled, sessionId };
  };

  const readCustomerViewFromDB = async (): Promise<void> => {
    const { data, error } = await supabase
      .from(VIEW_STATE_TABLE)
      .select("id, session_id, enabled, updated_at")
      .eq("id", VIEW_STATE_ID)
      .maybeSingle();

    if (error) return;

    const row = (data ?? null) as CustomerViewRow | null;
    if (!row) return;

    const enabled = toBool(row.enabled);
    const sid = String(row.session_id ?? "").trim();

    const prev = lastGoodRef.current;
    if (prev.enabled === enabled && prev.sessionId === sid) return;

    applyViewState(enabled, sid);

    if (!enabled) {
      setReceipt(null);
      setReceiptLoading(false);
    } else if (showReceipt && enabled && sid) {
      void fetchReceiptById(sid, { silent: true });
    }
  };

  const startCustomerViewRealtime = (): void => {
    const ch = supabase
      .channel("customer_view_state_changes_bookadd_stable")
      .on("postgres_changes", { event: "*", schema: "public", table: VIEW_STATE_TABLE }, (payload) => {
        const next = (payload.new ?? null) as unknown as CustomerViewRow | null;
        if (!next) return;
        if (Number(next.id) !== VIEW_STATE_ID) return;

        const enabled = toBool(next.enabled);
        const sid = String(next.session_id ?? "").trim();

        const prev = lastGoodRef.current;
        if (prev.enabled === enabled && prev.sessionId === sid) return;

        applyViewState(enabled, sid);

        if (!enabled) {
          setReceipt(null);
          setReceiptLoading(false);
          return;
        }

        if (showReceipt && enabled && sid) {
          void fetchReceiptById(sid, { silent: true });
        }
      })
      .subscribe();

    channelRef.current = ch;

    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      void readCustomerViewFromDB();
    }, 5000);
  };

  useEffect(() => {
    void readCustomerViewFromDB();
    startCustomerViewRealtime();

    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchReceiptById = async (id: string, opts?: { silent?: boolean }): Promise<void> => {
    if (!id) return;

    const silent = Boolean(opts?.silent);
    const seq = ++fetchSeqRef.current;

    if (!silent) setReceiptLoading(true);

    const cs = await supabase
      .from("customer_sessions")
      .select(
        "id,date,full_name,phone_number,customer_type,customer_field,seat_number,time_started,time_ended,hour_avail,reservation,reservation_date,total_amount,down_payment,discount_kind,discount_value,gcash_amount,cash_amount,is_paid"
      )
      .eq("id", id)
      .maybeSingle();

    if (seq !== fetchSeqRef.current) return;

    if (!cs.error && cs.data) {
      const d = cs.data as {
        id: string;
        date: string;
        full_name: string;
        phone_number: string | null;

        customer_type: string;
        customer_field: string | null;
        seat_number: string;

        time_started: string;
        time_ended: string;
        hour_avail: string;

        reservation: string | null;
        reservation_date: string | null;

        total_amount: number | string | null;
        down_payment: number | string | null;

        discount_kind: unknown;
        discount_value: unknown;

        gcash_amount: unknown;
        cash_amount: unknown;
        is_paid: unknown;
      };

      const rec: CustomerSessionReceipt = {
        kind: "session",
        id: d.id,
        date: d.date,
        full_name: d.full_name,
        phone_number: d.phone_number ?? null,

        customer_type: d.customer_type,
        customer_field: d.customer_field ?? null,
        seat_number: d.seat_number,

        time_started: d.time_started,
        time_ended: d.time_ended,
        hour_avail: d.hour_avail,

        reservation: d.reservation ?? null,
        reservation_date: d.reservation_date ?? null,

        total_amount: toMoney(d.total_amount),
        down_payment: round2(Math.max(0, toMoney(d.down_payment ?? 0))),

        discount_kind: normalizeDiscountKind(d.discount_kind),
        discount_value: round2(toMoney(d.discount_value)),

        gcash_amount: round2(toMoney(d.gcash_amount)),
        cash_amount: round2(toMoney(d.cash_amount)),
        is_paid: d.is_paid as boolean | number | string | null,
      };

      setReceipt(rec);
      if (!silent) setReceiptLoading(false);
      return;
    }

    if (cs.error) {
      if (!silent) setReceiptLoading(false);
      return;
    }

    const pb = await supabase
      .from("promo_bookings")
      .select(
        `
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
        discount_kind,
        discount_value,
        discount_reason,
        packages:package_id ( title ),
        package_options:package_option_id (
          option_name,
          duration_value,
          duration_unit
        )
      `
      )
      .eq("id", id)
      .maybeSingle();

    if (seq !== fetchSeqRef.current) return;

    if (!pb.error && pb.data) {
      type PackageJoin = { title: string | null } | { title: string | null }[] | null;
      type OptionJoin =
        | { option_name: string | null; duration_value: number | null; duration_unit: string | null }
        | { option_name: string | null; duration_value: number | null; duration_unit: string | null }[]
        | null;

      const d = pb.data as {
        id: string;
        created_at: string;
        full_name: string;
        phone_number: string | null;

        area: unknown;
        seat_number: string | null;
        start_at: string;
        end_at: string;

        price: number | string | null;
        gcash_amount: number | string | null;
        cash_amount: number | string | null;
        is_paid: boolean | number | string | null;

        discount_kind: unknown;
        discount_value: unknown;
        discount_reason: string | null;

        packages: PackageJoin;
        package_options: OptionJoin;
      };

      const pkgObj = Array.isArray(d.packages) ? d.packages[0] ?? null : d.packages;
      const optObj = Array.isArray(d.package_options) ? d.package_options[0] ?? null : d.package_options;

      const rec: PromoReceipt = {
        kind: "promo",
        id: d.id,
        created_at: d.created_at,
        full_name: d.full_name,
        phone_number: d.phone_number ?? null,

        area: normalizeArea(d.area),
        seat_number: d.seat_number ?? null,
        start_at: d.start_at,
        end_at: d.end_at,

        price: round2(toMoney(d.price)),
        gcash_amount: round2(toMoney(d.gcash_amount)),
        cash_amount: round2(toMoney(d.cash_amount)),
        is_paid: d.is_paid,

        discount_kind: normalizeDiscountKind(d.discount_kind),
        discount_value: round2(toMoney(d.discount_value)),
        discount_reason: d.discount_reason ?? null,

        packages: pkgObj,
        package_options: optObj
          ? {
              option_name: optObj.option_name ?? null,
              duration_value: optObj.duration_value ?? null,
              duration_unit: optObj.duration_unit == null ? null : normalizeDurationUnit(optObj.duration_unit),
            }
          : null,
      };

      setReceipt(rec);
      if (!silent) setReceiptLoading(false);
      return;
    }

    if (pb.error) {
      if (!silent) setReceiptLoading(false);
      return;
    }

    setReceipt(null);
    if (!silent) setReceiptLoading(false);
  };

  useEffect(() => {
    if (!showReceipt) return;
    if (!customerViewEnabled || !customerSessionId) return;

    const t = window.setInterval(() => {
      void fetchReceiptById(customerSessionId, { silent: true });
    }, 2000);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReceipt, customerViewEnabled, customerSessionId]);

  const openReceipt = async (): Promise<void> => {
    if (!customerViewEnabled || !customerSessionId) return;
    setShowReceipt(true);
    await fetchReceiptById(customerSessionId, { silent: false });
  };

  const handlePromoSaved = (): void => {
    // optional refresh-only
  };

  return (
    <IonPage className="bookadd-page bookadd-animate">
      <IonHeader />

      <IonContent fullscreen className="bookadd-content" scrollY={false}>
        {/* ✅ LEAVES */}
        <div className="leaf leaf-top-left">
          <img src={leaves} className="leaf-img" alt="leaf" />
        </div>
        <div className="leaf leaf-top-right">
          <img src={leaves} className="leaf-img" alt="leaf" />
        </div>
        <div className="leaf leaf-bottom-left">
          <img src={leaves} className="leaf-img" alt="leaf" />
        </div>
        <div className="leaf leaf-bottom-right">
          <img src={leaves} className="leaf-img" alt="leaf" />
        </div>

        {/* ✅ WHITE BEAR */}
        <div className="bookadd-bear" aria-hidden="true">
          <img src={whiteBear} className="bookadd-bear-img" alt="" draggable={false} />
        </div>

        <div className="bookadd-wrapper">
          <div className="bookadd-hero-card">
            <div className="bookadd-hero-header">
              <div className="bookadd-hero-brand">
                <button
                  type="button"
                  className="bookadd-hero-logo-btn"
                  onClick={(e) => {
                    (e.currentTarget as HTMLButtonElement).blur();
                    history.push("/login");
                  }}
                >
                  <img src={studyHubLogo} className="bookadd-hero-logo" alt="Study Hub" draggable={false} />
                </button>

                <div className="bookadd-hero-text">
                  <p className="bookadd-hero-title">Welcome to Me Tyme Lounge!</p>
                  <p className="bookadd-hero-subtitle">Rest, relax, and focus in a peaceful environment.</p>
                </div>
              </div>

              <button
                type="button"
                className={`bookadd-hero-chip ${canOpenReceipt ? "is-receipt" : ""}`}
                onClick={() => void openReceipt()}
                disabled={!canOpenReceipt}
                title={canOpenReceipt ? "Tap to view your receipt" : "Enable View to Customer first"}
                aria-label={chipText}
              >
                <span className="bookadd-hero-chip-dot" />
                <span className="bookadd-hero-chip-text">{chipText}</span>
              </button>
            </div>

            <div className="bookadd-topbar">
              <p className="bookadd-topbar-title">Choose Action</p>
              <p className="bookadd-topbar-subtitle">Book your seat, choose promos, or order add-ons separately.</p>
            </div>

            <div className="bookadd-actions">
              <div className="bookadd-btn-card bookadd-btn-booking">
                <span className="bookadd-btn-label">Booking</span>
                <p className="bookadd-btn-desc">Choose your seat and preferred booking time.</p>
                <IonButton expand="block" onClick={() => setIsBookingOpen(true)}>
                  Booking
                </IonButton>
              </div>

              <div className="bookadd-btn-card bookadd-btn-promo">
                <span className="bookadd-btn-label">Promo</span>
                <p className="bookadd-btn-desc">Select package and schedule your start time.</p>
                <IonButton expand="block" onClick={() => setIsPromoOpen(true)}>
                  Promo
                </IonButton>
              </div>

              {/* ✅ Add-Ons */}
              <div className="bookadd-btn-card bookadd-btn-addons">
                <span className="bookadd-btn-label">Add-Ons</span>
                <p className="bookadd-btn-desc">Enter seat + name then choose add-ons.</p>
                <IonButton expand="block" onClick={() => setIsAddOnsOpen(true)}>
                  Add-Ons
                </IonButton>
              </div>

              {/* ✅ Seat View (MODAL view-only) */}
              <div className="bookadd-btn-card bookadd-btn-addons">
                <span className="bookadd-btn-label">Seat View</span>
                <p className="bookadd-btn-desc">Check which seats are occupied or available.</p>
                <IonButton expand="block" onClick={() => setIsSeatOpen(true)}>
                  Seat View
                </IonButton>
              </div>
            </div>
          </div>
        </div>

        {/* MODALS */}
        <BookingModal
          isOpen={isBookingOpen}
          onClose={() => setIsBookingOpen(false)}
          onSaved={(isReservation: boolean) => {
            setBookingSavedMessage(isReservation ? "Reservation booking successfully." : "Booking saved successfully.");
            setBookingSavedOpen(true);
          }}
          seatGroups={SEAT_GROUPS}
        />

        <PromoModal
          isOpen={isPromoOpen}
          onClose={() => setIsPromoOpen(false)}
          onSaved={handlePromoSaved}
          seatGroups={SEAT_GROUPS}
        />

        <AddOnsModal
          isOpen={isAddOnsOpen}
          onClose={() => setIsAddOnsOpen(false)}
          onSaved={() => setAddOnsSentOpen(true)}
          seatGroups={SEAT_GROUPS}
        />

        {/* ✅ SEAT VIEW MODAL (FIXED THEME — NO WHITE BACKGROUND) */}
        <IonModal
          isOpen={isSeatOpen}
          onDidDismiss={() => setIsSeatOpen(false)}
          className="booking-modal seatview-modal"
        >
          <IonHeader>
            <IonToolbar className="seatview-modal-toolbar">
              <IonTitle>Seat View</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setIsSeatOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <div className="seatview-modal-body">
              <Seat />
            </div>
          </IonContent>
        </IonModal>

        {/* ALERTS */}
        <IonAlert
          isOpen={bookingSavedOpen}
          header="Saved"
          message={bookingSavedMessage}
          buttons={[
            {
              text: "OK",
              handler: () => {
                setBookingSavedOpen(false);
                setIsBookingOpen(false);
              },
            },
          ]}
        />

        <IonAlert
          isOpen={addOnsSentOpen}
          header="Sent"
          message={"Thank you! kindly proceed to the counter for pickup and payment."}
          buttons={[
            {
              text: "OK",
              handler: () => {
                setAddOnsSentOpen(false);
                setIsAddOnsOpen(false);
              },
            },
          ]}
        />

        {/* ✅ RECEIPT OVERLAY */}
        {showReceipt && (
          <div className="receipt-overlay" onClick={() => setShowReceipt(false)}>
            <div
              className="receipt-container"
              onClick={(e) => e.stopPropagation()}
              style={{ maxHeight: "90vh", overflowY: "auto", paddingBottom: 14 }}
            >
              <img src={logo} alt="Me Tyme Lounge" className="receipt-logo" />
              <h3 className="receipt-title">ME TYME LOUNGE</h3>

              <p className="receipt-subtitle">
                {!receipt
                  ? "OFFICIAL RECEIPT"
                  : isPromoReceipt(receipt)
                  ? "PROMO RECEIPT"
                  : isReservationSession(receipt)
                  ? "RESERVATION RECEIPT"
                  : "OFFICIAL RECEIPT"}
              </p>

              <hr />

              {!customerViewEnabled || !customerSessionId ? (
                <p className="receipt-footer" style={{ textAlign: "center" }}>
                  Waiting for staff to enable <strong>View to Customer</strong>...
                </p>
              ) : receiptLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                  <IonSpinner />
                </div>
              ) : !receipt ? (
                <p className="receipt-footer" style={{ textAlign: "center" }}>
                  No receipt found.
                </p>
              ) : isPromoReceipt(receipt) ? (
                <>
                  {/* PROMO RECEIPT */}
                  <div className="receipt-row">
                    <span>Date</span>
                    <span>{new Date(receipt.created_at).toLocaleString("en-PH")}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Customer</span>
                    <span>{receipt.full_name}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Phone</span>
                    <span>{safePhone(receipt.phone_number)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Area</span>
                    <span>{prettyArea(receipt.area)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Seat</span>
                    <span>{seatLabelPromo(receipt)}</span>
                  </div>

                  <hr />

                  <div className="receipt-row">
                    <span>Package</span>
                    <span>{receipt.packages?.title || "—"}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Option</span>
                    <span>{receipt.package_options?.option_name || "—"}</span>
                  </div>

                  {receipt.package_options?.duration_value && receipt.package_options?.duration_unit ? (
                    <div className="receipt-row">
                      <span>Duration</span>
                      <span>
                        {formatDuration(
                          Number(receipt.package_options.duration_value),
                          receipt.package_options.duration_unit
                        )}
                      </span>
                    </div>
                  ) : null}

                  <hr />

                  <div className="receipt-row">
                    <span>Start</span>
                    <span>{new Date(receipt.start_at).toLocaleString("en-PH")}</span>
                  </div>

                  <div className="receipt-row">
                    <span>End</span>
                    <span>{new Date(receipt.end_at).toLocaleString("en-PH")}</span>
                  </div>

                  <hr />

                  {(() => {
                    const base = round2(Math.max(0, toMoney(receipt.price)));
                    const { discountedCost, discountAmount } = applyDiscount(
                      base,
                      receipt.discount_kind,
                      receipt.discount_value
                    );
                    const due = round2(discountedCost);

                    const gcash = round2(Math.max(0, toMoney(receipt.gcash_amount)));
                    const cash = round2(Math.max(0, toMoney(receipt.cash_amount)));
                    const totalPaid = round2(gcash + cash);
                    const remaining = round2(Math.max(0, due - totalPaid));
                    const paid = toBool(receipt.is_paid);

                    return (
                      <>
                        <div className="receipt-row">
                          <span>System Cost (Before)</span>
                          <span>₱{base.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Discount</span>
                          <span>{getDiscountTextFrom(receipt.discount_kind, receipt.discount_value)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Discount Amount</span>
                          <span>₱{discountAmount.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Final Cost</span>
                          <span>₱{due.toFixed(2)}</span>
                        </div>

                        <hr />

                        <div className="receipt-row">
                          <span>GCash</span>
                          <span>₱{gcash.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Cash</span>
                          <span>₱{cash.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Total Paid</span>
                          <span>₱{totalPaid.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Remaining</span>
                          <span>₱{remaining.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Status</span>
                          <span className="receipt-status">{paid ? "PAID" : "UNPAID"}</span>
                        </div>

                        <div className="receipt-total">
                          <span>TOTAL</span>
                          <span>₱{due.toFixed(2)}</span>
                        </div>
                      </>
                    );
                  })()}

                  <p className="receipt-footer">
                    Thank you for choosing <br />
                    <strong>Me Tyme Lounge</strong>
                  </p>
                </>
              ) : (
                <>
                  {/* CUSTOMER SESSION RECEIPT */}
                  {isReservationSession(receipt) && (
                    <div className="receipt-row">
                      <span>Reservation Date</span>
                      <span>{receipt.reservation_date ?? "N/A"}</span>
                    </div>
                  )}

                  <div className="receipt-row">
                    <span>Date</span>
                    <span>{receipt.date}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Customer</span>
                    <span>{receipt.full_name}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Phone</span>
                    <span>{safePhone(receipt.phone_number)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Type</span>
                    <span>{receipt.customer_type}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Field</span>
                    <span>{receipt.customer_field ?? ""}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Seat</span>
                    <span>{receipt.seat_number}</span>
                  </div>

                  <hr />

                  <div className="receipt-row">
                    <span>Time In</span>
                    <span>{formatTimeText(receipt.time_started)}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Time Out</span>
                    <span>{isOpenTimeSession(receipt) ? "OPEN" : formatTimeText(receipt.time_ended) || "—"}</span>
                  </div>

                  {(() => {
                    const endIso = isOpenTimeSession(receipt) ? new Date().toISOString() : receipt.time_ended;
                    const used = diffMinutes(receipt.time_started, endIso);
                    const charge = Math.max(0, used - FREE_MINUTES);

                    return (
                      <>
                        <div className="receipt-row">
                          <span>Minutes Used</span>
                          <span>{used} min</span>
                        </div>

                        <div className="receipt-row">
                          <span>Charge Minutes</span>
                          <span>{charge} min</span>
                        </div>
                      </>
                    );
                  })()}

                  <hr />

                  {(() => {
                    const disp = getDisplayAmount(receipt);

                    const baseCost = getBaseSystemCost(receipt);
                    const calc = applyDiscount(baseCost, receipt.discount_kind, receipt.discount_value);

                    const dp = round2(Math.max(0, toMoney(receipt.down_payment ?? 0)));

                    const gcash = round2(Math.max(0, toMoney(receipt.gcash_amount)));
                    const cash = round2(Math.max(0, toMoney(receipt.cash_amount)));
                    const totalPaid = round2(gcash + cash);

                    const dpBalance = round2(Math.max(0, calc.discountedCost - dp));
                    const remaining = round2(Math.max(0, dpBalance - totalPaid));

                    const bottomLabel = dpBalance > 0 ? "PAYMENT DUE" : "TOTAL CHANGE";
                    const bottomValue = dpBalance > 0 ? dpBalance : round2(Math.max(0, dp - calc.discountedCost));

                    return (
                      <>
                        <div className="receipt-row">
                          <span>{disp.label}</span>
                          <span>₱{disp.value.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Down Payment</span>
                          <span>₱{dp.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Discount</span>
                          <span>{getDiscountTextFrom(receipt.discount_kind, receipt.discount_value)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Discount Amount</span>
                          <span>₱{calc.discountAmount.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>System Cost (Payment Basis)</span>
                          <span>₱{calc.discountedCost.toFixed(2)}</span>
                        </div>

                        <hr />

                        <div className="receipt-row">
                          <span>GCash</span>
                          <span>₱{gcash.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Cash</span>
                          <span>₱{cash.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Total Paid</span>
                          <span>₱{totalPaid.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Remaining Balance (After DP)</span>
                          <span>₱{remaining.toFixed(2)}</span>
                        </div>

                        <div className="receipt-row">
                          <span>Status</span>
                          <span className="receipt-status">{toBool(receipt.is_paid) ? "PAID" : "UNPAID"}</span>
                        </div>

                        <div className="receipt-total">
                          <span>{bottomLabel}</span>
                          <span>₱{bottomValue.toFixed(2)}</span>
                        </div>
                      </>
                    );
                  })()}

                  <p className="receipt-footer">
                    Thank you for choosing <br />
                    <strong>Me Tyme Lounge</strong>
                  </p>
                </>
              )}

              <button className="close-btn" onClick={() => setShowReceipt(false)}>
                Close
              </button>
            </div>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Book_Add;
