// src/components/PromoModal.tsx
// ✅ STRICT TS
// ✅ NO any
// ✅ Required/errors/success = IonAlert modal only
// ✅ Uses seat_blocked_times (EXCLUDE overlap) to block seats/conference after saving promo
// ✅ Friendly overlap modal when seat_blocked_times_no_overlap hit
// ✅ After success OK: closes THIS promo modal only
// ✅ THEMED: className="booking-modal" + bookadd-card + form-item
// ✅ Phone Number required + 09 + exactly 11 digits
// ✅ If promo duration >= 7 days => auto-generate PROMO CODE
// ✅ Save promo_code + created_by_staff_id (if staff/admin logged in)
// ✅ FIX: Promo attempts + validity are copied from package_options (promo_max_attempts / promo_validity_days)
// ✅ Attendance IN/OUT uses promo_booking_attendance (FK to promo_bookings)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonCard,
  IonCardContent,
  IonAlert,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

/* ================= TYPES ================= */

type SeatGroup = { title: string; seats: string[] };
type PackageArea = "common_area" | "conference_room";
type DurationUnit = "hour" | "day" | "month" | "year";

interface PackageRow {
  id: string;
  area: PackageArea;
  title: string;
  description: string | null;
  amenities: string | null;
  is_active: boolean;
}

interface PackageOptionRow {
  id: string;
  package_id: string;
  option_name: string;
  duration_value: number;
  duration_unit: DurationUnit;
  price: number | string;

  // ✅ PROMO config from DB
  promo_max_attempts?: number | string | null;
  promo_validity_days?: number | string | null;
}

interface PromoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void; // parent refresh ONLY
  seatGroups: SeatGroup[];
}

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "regular" | "reserved" | string;
};

type SeatBlockedInsert = {
  created_by: string | null;
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "regular" | "reserved";
  note: string | null;
};

type PromoBookingLookupRow = {
  id: string;
  promo_code: string | null;
  full_name: string | null;
  phone_number: string | null;
  attempts_left: number | null;
  max_attempts: number | null;
  validity_end_at: string | null;
  end_at: string | null;
};

type PromoBookingAttendanceLogRow = {
  id: string;
  created_at: string;
  promo_booking_id: string;
  local_day: string;
  in_at: string;
  out_at: string | null;
  auto_out: boolean;
  note: string | null;
};

// ✅ typed row for promo_bookings select (NO any)
type PromoBookingSelectRow = {
  id: string;
  promo_code: string | null;
  full_name: string | null;
  phone_number: string | null;
  attempts_left: number | null;
  max_attempts: number | null;
  validity_end_at: string | null;
  end_at: string | null;
};

const isPackageArea = (v: unknown): v is PackageArea => v === "common_area" || v === "conference_room";

/* ================= HELPERS ================= */

const toNum = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const toInt = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
};

const clampInt = (n: number, min: number, max: number): number => {
  const x = Math.floor(Number.isFinite(n) ? n : 0);
  return Math.min(max, Math.max(min, x));
};

const localToIso = (v: string): string => new Date(v).toISOString();

const isoToLocal = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const minLocalNow = (): string => isoToLocal(new Date().toISOString());

const parseAmenities = (text: string | null): string[] => {
  if (!text) return [];
  return text
    .split(/\r?\n|•/g)
    .map((x) => x.trim())
    .filter(Boolean);
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

const computeEndIso = (startIso: string, opt: PackageOptionRow): string => {
  const d = new Date(startIso);
  const v = Number(opt.duration_value || 0);

  if (opt.duration_unit === "hour") d.setHours(d.getHours() + v);
  if (opt.duration_unit === "day") d.setDate(d.getDate() + v);
  if (opt.duration_unit === "month") d.setMonth(d.getMonth() + v);
  if (opt.duration_unit === "year") d.setFullYear(d.getFullYear() + v);

  return d.toISOString();
};

const computeStatus = (startIso: string, endIso: string): "upcoming" | "ongoing" | "finished" => {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "upcoming";
  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "ongoing";
  return "finished";
};

/* ✅ Phone number helpers (09 + exactly 11 digits) */
const normalizePhone = (raw: string): string => String(raw).replace(/\D/g, "");
const isValidPHPhone09 = (digits: string): boolean => /^09\d{9}$/.test(digits);
const phoneErrorMessage = (digits: string): string | null => {
  if (!digits) return "Phone number is required.";
  if (!digits.startsWith("09")) return "Phone number must start with 09.\n\nExample: 09123456789";
  if (digits.length < 11) return "Phone number is too short. It must be exactly 11 digits.\n\nExample: 09123456789";
  if (digits.length > 11) return "Phone number is too long. It must be exactly 11 digits.\n\nExample: 09123456789";
  if (!isValidPHPhone09(digits)) return "Invalid phone number.\n\nExample: 09123456789";
  return null;
};

const normalizeCode = (v: string): string =>
  String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

const randomCode = (len: number): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

/** convert option duration to "approx days" for threshold check */
const approxDaysFromOption = (opt: PackageOptionRow | null): number => {
  if (!opt) return 0;
  const v = Number(opt.duration_value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (opt.duration_unit === "hour") return 0;
  if (opt.duration_unit === "day") return v;
  if (opt.duration_unit === "month") return v * 30;
  return v * 365;
};

// ✅ Manila local day YYYY-MM-DD
const manilaLocalDay = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
};

const addDaysIso = (startIso: string, days: number): string => {
  const d = new Date(startIso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const isExpiredIso = (iso: string | null): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() > t;
};

/** Overlap rule: existing.start < new.end AND existing.end > new.start */
const checkPromoAvailability = async (params: {
  area: PackageArea;
  seatNumber: string;
  startIso: string;
  endIso: string;
}): Promise<{ ok: boolean; message?: string }> => {
  const { area, seatNumber, startIso, endIso } = params;

  let q1 = supabase
    .from("promo_bookings")
    .select("id", { count: "exact", head: true })
    .in("status", ["upcoming", "ongoing"])
    .eq("area", area)
    .lt("start_at", endIso)
    .gt("end_at", startIso);

  if (area === "common_area") q1 = q1.eq("seat_number", seatNumber);
  else q1 = q1.is("seat_number", null);

  const r1 = await q1;
  if (r1.error) return { ok: false, message: r1.error.message };
  if ((r1.count ?? 0) > 0) {
    return {
      ok: false,
      message:
        area === "common_area"
          ? "Seat is not available for the selected schedule."
          : "Conference room is not available for the selected schedule.",
    };
  }

  const seatKey = area === "conference_room" ? "CONFERENCE_ROOM" : seatNumber;

  const r2 = await supabase
    .from("customer_sessions")
    .select("id", { count: "exact", head: true })
    .lt("time_started", endIso)
    .gt("time_ended", startIso)
    .eq("seat_number", seatKey);

  if (r2.error) return { ok: false, message: r2.error.message };
  if ((r2.count ?? 0) > 0) {
    return {
      ok: false,
      message:
        area === "common_area"
          ? "Seat is already occupied in customer sessions for that schedule."
          : "Conference room is already occupied in customer sessions for that schedule.",
    };
  }

  return { ok: true };
};

const isConferenceOverlapConstraint = (msg: string): boolean => {
  const m = msg.toLowerCase();
  return m.includes("promo_no_overlap_conference") || m.includes("exclusion constraint");
};

const isSeatBlockedOverlap = (msg: string): boolean => {
  const m = msg.toLowerCase();
  return m.includes("seat_blocked_times_no_overlap") || (m.includes("duplicate key") === false && m.includes("exclusion constraint"));
};

/* ================= COMPONENT ================= */

const PromoModal: React.FC<PromoModalProps> = ({ isOpen, onClose, onSaved, seatGroups }) => {
  const [loading, setLoading] = useState<boolean>(false);

  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertHeader, setAlertHeader] = useState<string>("Notice");
  const [alertMessage, setAlertMessage] = useState<string>("");
  const [afterAlert, setAfterAlert] = useState<"none" | "close_after_save">("none");

  const showAlert = (header: string, msg: string, after: "none" | "close_after_save" = "none"): void => {
    setAlertHeader(header);
    setAlertMessage(msg);
    setAfterAlert(after);
    setAlertOpen(true);
  };

  const localRole = useMemo(() => String(localStorage.getItem("role") ?? "").toLowerCase(), []);
  const isStaffLike = useMemo(() => localRole === "staff" || localRole === "admin", [localRole]);

  const [fullName, setFullName] = useState<string>("");
  const [phoneNumber, setPhoneNumber] = useState<string>("");
  const [area, setArea] = useState<PackageArea>("common_area");
  const [packageId, setPackageId] = useState<string>("");
  const [optionId, setOptionId] = useState<string>("");
  const [seatNumber, setSeatNumber] = useState<string>("");
  const [startIso, setStartIso] = useState<string>("");

  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [options, setOptions] = useState<PackageOptionRow[]>([]);

  const [occupiedSeats, setOccupiedSeats] = useState<string[]>([]);
  const [conferenceBlocked, setConferenceBlocked] = useState<boolean>(false);

  const [promoCode, setPromoCode] = useState<string>("");
  const [codeBusy, setCodeBusy] = useState<boolean>(false);

  // ✅ Attendance modal state
  const [attModalOpen, setAttModalOpen] = useState<boolean>(false);
  const [codeInput, setCodeInput] = useState<string>("");
  const [attAction, setAttAction] = useState<"in" | "out">("in");
  const [attNote, setAttNote] = useState<string>("");
  const [attBusy, setAttBusy] = useState<boolean>(false);
  const [attHistory, setAttHistory] = useState<PromoBookingAttendanceLogRow[]>([]);
  const [attLookupBusy, setAttLookupBusy] = useState<boolean>(false);

  const allSeats = useMemo<{ label: string; value: string }[]>(() => {
    const list: { label: string; value: string }[] = [];
    seatGroups.forEach((g) => {
      g.seats.forEach((s) => list.push({ label: `${g.title} - Seat ${s}`, value: s }));
    });
    return list;
  }, [seatGroups]);

  const allSeatValues = useMemo<string[]>(() => allSeats.map((s) => s.value), [allSeats]);

  const activePackages = useMemo(() => packages.filter((p) => p.is_active), [packages]);
  const areaPackages = useMemo(() => activePackages.filter((p) => p.area === area), [activePackages, area]);

  const selectedPackage = useMemo<PackageRow | null>(() => {
    return areaPackages.find((p) => p.id === packageId) ?? null;
  }, [areaPackages, packageId]);

  const packageOptions = useMemo<PackageOptionRow[]>(() => {
    if (!packageId) return [];
    return options.filter((o) => o.package_id === packageId);
  }, [options, packageId]);

  const selectedOption = useMemo<PackageOptionRow | null>(() => {
    return packageOptions.find((o) => o.id === optionId) ?? null;
  }, [packageOptions, optionId]);

  const amenitiesList = useMemo(() => parseAmenities(selectedPackage?.amenities ?? null), [selectedPackage]);

  const totalAmount = useMemo<number>(() => {
    if (!selectedOption) return 0;
    return Number(toNum(selectedOption.price).toFixed(2));
  }, [selectedOption]);

  const endIso = useMemo<string>(() => {
    if (!selectedOption || !startIso) return "";
    return computeEndIso(startIso, selectedOption);
  }, [selectedOption, startIso]);

  const statusPreview = useMemo(() => {
    if (!startIso || !endIso) return "";
    return computeStatus(startIso, endIso).toUpperCase();
  }, [startIso, endIso]);

  const endTimeLabel = useMemo<string>(() => {
    if (!endIso) return "";
    return new Date(endIso).toLocaleString("en-PH");
  }, [endIso]);

  const availableSeatOptions = useMemo(() => {
    const blocked = new Set(occupiedSeats.map((x) => String(x).trim()).filter(Boolean));
    return allSeats.filter((s) => !blocked.has(s.value));
  }, [allSeats, occupiedSeats]);

  const fetchBlocked = async (start: string, end: string): Promise<void> => {
    const seatKeys = [...allSeatValues, "CONFERENCE_ROOM"];

    const { data, error } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .in("seat_number", seatKeys)
      .lt("start_at", end)
      .gt("end_at", start);

    if (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      setOccupiedSeats([]);
      setConferenceBlocked(false);
      return;
    }

    const rows = (data ?? []) as SeatBlockedRow[];
    const blockedSeats = rows.map((r) => String(r.seat_number).trim()).filter(Boolean);

    setOccupiedSeats(blockedSeats.filter((s) => s !== "CONFERENCE_ROOM"));
    setConferenceBlocked(blockedSeats.includes("CONFERENCE_ROOM"));
  };

  // generate unique promo code (for promo_bookings)
  const ensureUniquePromoCode = async (): Promise<string> => {
    for (let i = 0; i < 10; i += 1) {
      const candidate = randomCode(8);
      const { count, error } = await supabase
        .from("promo_bookings")
        .select("id", { count: "exact", head: true })
        .eq("promo_code", candidate);

      if (error) throw new Error(error.message);
      if ((count ?? 0) === 0) return candidate;
    }
    return `${randomCode(10)}`;
  };

  const maybeGenerateCode = async (): Promise<void> => {
    const days = approxDaysFromOption(selectedOption);
    if (days < 7) {
      setPromoCode("");
      return;
    }
    if (promoCode) return;
    try {
      setCodeBusy(true);
      const c = await ensureUniquePromoCode();
      setPromoCode(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Code generation failed.";
      showAlert("Error", msg);
      setPromoCode("");
    } finally {
      setCodeBusy(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const load = async (): Promise<void> => {
      setLoading(true);

      setFullName("");
      setPhoneNumber("");
      setArea("common_area");
      setPackageId("");
      setOptionId("");
      setSeatNumber("");
      setStartIso("");
      setOccupiedSeats([]);
      setConferenceBlocked(false);

      setPromoCode("");

      setAttModalOpen(false);
      setCodeInput("");
      setAttAction("in");
      setAttNote("");
      setAttHistory([]);

      const pkRes = await supabase
        .from("packages")
        .select("id, area, title, description, amenities, is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (pkRes.error) {
        setPackages([]);
        setOptions([]);
        setLoading(false);
        showAlert("Error", pkRes.error.message);
        return;
      }

      // ✅ include promo_max_attempts / promo_validity_days
      const opRes = await supabase
        .from("package_options")
        .select("id, package_id, option_name, duration_value, duration_unit, price, promo_max_attempts, promo_validity_days")
        .order("created_at", { ascending: true });

      if (opRes.error) {
        setPackages((pkRes.data as PackageRow[]) ?? []);
        setOptions([]);
        setLoading(false);
        showAlert("Error", opRes.error.message);
        return;
      }

      setPackages((pkRes.data as PackageRow[]) ?? []);
      setOptions((opRes.data as PackageOptionRow[]) ?? []);
      setLoading(false);
    };

    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    setPackageId("");
    setOptionId("");
    setSeatNumber("");
    setPromoCode("");
  }, [area]);

  useEffect(() => {
    setOptionId("");
    setSeatNumber("");
    setPromoCode("");
  }, [packageId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!startIso || !endIso) {
      setOccupiedSeats([]);
      setConferenceBlocked(false);
      return;
    }
    void fetchBlocked(startIso, endIso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, startIso, endIso, allSeatValues.join("|")]);

  useEffect(() => {
    if (area !== "common_area") return;
    if (!seatNumber) return;
    if (occupiedSeats.includes(seatNumber)) setSeatNumber("");
  }, [area, seatNumber, occupiedSeats]);

  useEffect(() => {
    if (!isOpen) return;
    if (area !== "conference_room") return;
    if (!startIso || !endIso) return;
    if (!conferenceBlocked) return;

    showAlert("Not Available", "Conference room is not available for the selected schedule.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, area, startIso, endIso, conferenceBlocked]);

  useEffect(() => {
    if (!isOpen) return;
    void maybeGenerateCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, optionId]);

  const createSeatBlock = async (params: {
    userId: string | null;
    area: PackageArea;
    seatNumber: string;
    startIso: string;
    endIso: string;
  }): Promise<{ ok: boolean; message?: string }> => {
    const { userId, area, seatNumber, startIso, endIso } = params;

    const seatKey = area === "conference_room" ? "CONFERENCE_ROOM" : seatNumber;

    const payload: SeatBlockedInsert = {
      created_by: userId,
      seat_number: seatKey,
      start_at: startIso,
      end_at: endIso,
      source: "reserved",
      note: "promo",
    };

    const ins = await supabase.from("seat_blocked_times").insert(payload);

    if (ins.error) {
      const msg = ins.error.message ?? "Seat blocking failed.";
      if (isSeatBlockedOverlap(msg)) {
        return {
          ok: false,
          message:
            area === "conference_room"
              ? "Conference room is not available for the selected schedule."
              : "Seat is not available for the selected schedule.",
        };
      }
      return { ok: false, message: msg };
    }

    return { ok: true };
  };

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      showAlert("Copied", "Code copied to clipboard.");
    } catch {
      showAlert("Copy Failed", "Your browser blocked clipboard. You can manually copy the code.");
    }
  };

  const submitPromo = async (): Promise<void> => {
    const name = fullName.trim();
    const phoneDigits = normalizePhone(phoneNumber);

    if (!name) return showAlert("Required", "Full name is required.");

    const pErr = phoneErrorMessage(phoneDigits);
    if (pErr) return showAlert("Invalid Phone Number", pErr);

    if (!selectedPackage) return showAlert("Required", "Select promo package.");
    if (!selectedOption) return showAlert("Required", "Select duration/price option.");
    if (!startIso) return showAlert("Required", "Select start date & time.");
    if (!endIso) return showAlert("Required", "Invalid end time.");

    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs) || startMs < Date.now()) {
      return showAlert("Invalid", "Start time must be today or later.");
    }

    if (area === "conference_room" && conferenceBlocked) {
      return showAlert("Not Available", "Conference room is not available for the selected schedule.");
    }

    if (area === "common_area") {
      if (!seatNumber) return showAlert("Required", "Seat number is required for Common Area.");
      if (occupiedSeats.includes(seatNumber)) {
        return showAlert("Not Available", "Selected seat is already occupied for that schedule.");
      }
    }

    // need code if duration >= 7 days
    const needCode = approxDaysFromOption(selectedOption) >= 7;
    let finalCode: string | null = null;

    // ✅ pull promo attempts/validity from option
    const optAttemptsRaw = toNum(selectedOption.promo_max_attempts ?? 7);
    const optValidityRaw = toNum(selectedOption.promo_validity_days ?? 14);

    const promoMaxAttempts = clampInt(optAttemptsRaw, 1, 9999);
    const promoValidityDays = clampInt(optValidityRaw, 1, 3650);

    // ✅ set booking validity_end_at based on start + promo_validity_days
    const validityEndAtIso = addDaysIso(startIso, promoValidityDays);

    try {
      setLoading(true);

      if (needCode) {
        if (!promoCode) {
          setCodeBusy(true);
          finalCode = await ensureUniquePromoCode();
          setPromoCode(finalCode);
        } else {
          finalCode = promoCode;
        }
      }

      const availability = await checkPromoAvailability({ area, seatNumber, startIso, endIso });
      if (!availability.ok) {
        setLoading(false);
        return showAlert("Not Available", availability.message ?? "Not available.");
      }

      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id ?? null;

      const createdByStaffId = isStaffLike ? userId : null;

      const payload = {
        user_id: userId,
        full_name: name,
        phone_number: phoneDigits,
        area,
        package_id: selectedPackage.id,
        package_option_id: selectedOption.id,
        seat_number: area === "common_area" ? seatNumber : null,
        start_at: startIso,
        end_at: endIso,
        price: toNum(selectedOption.price),
        status: computeStatus(startIso, endIso),

        promo_code: needCode ? (finalCode ?? promoCode) : null,
        created_by_staff_id: createdByStaffId,

        // ✅ THIS FIXES "No Attempts"
        max_attempts: needCode ? promoMaxAttempts : 0,
        attempts_left: needCode ? promoMaxAttempts : 0,
        validity_end_at: needCode ? validityEndAtIso : null,
      };

      const ins = await supabase.from("promo_bookings").insert(payload);

      if (ins.error) {
        if (isConferenceOverlapConstraint(ins.error.message)) {
          setLoading(false);
          return showAlert("Not Available", "Conference room is not available for the selected schedule.");
        }
        setLoading(false);
        return showAlert("Error", ins.error.message);
      }

      const blockRes = await createSeatBlock({
        userId,
        area,
        seatNumber,
        startIso,
        endIso,
      });

      if (!blockRes.ok) {
        setLoading(false);
        return showAlert("Not Available", blockRes.message ?? "Not available.");
      }

      setLoading(false);

      if (needCode && (finalCode ?? promoCode)) {
        showAlert(
          "Saved",
          `Promo booking saved successfully.\n\nCODE: ${(finalCode ?? promoCode) as string}\nAttempts: ${promoMaxAttempts}\nValidity: ${promoValidityDays} day(s)\nValid until: ${new Date(validityEndAtIso).toLocaleString("en-PH")}\n\nUse this code for attendance IN/OUT.`,
          "close_after_save"
        );
      } else {
        showAlert("Saved", "Promo booking saved successfully.", "close_after_save");
      }

      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      setLoading(false);
      showAlert("Error", msg);
    } finally {
      setCodeBusy(false);
    }
  };

  /* ================= ATTENDANCE ================= */

  const openAttendanceModal = (): void => {
    setAttModalOpen(true);
    if (promoCode) {
      setCodeInput(promoCode);
      void loadAttendanceHistory(promoCode);
    }
  };

  const closeAttendanceModal = (): void => {
    if (attBusy) return;
    setAttModalOpen(false);
  };

  const lookupBookingByCode = async (code: string): Promise<PromoBookingLookupRow | null> => {
    const c = normalizeCode(code);
    if (!c) return null;

    const { data, error } = await supabase
      .from("promo_bookings")
      .select("id, promo_code, full_name, phone_number, attempts_left, max_attempts, validity_end_at, end_at")
      .eq("promo_code", c)
      .maybeSingle<PromoBookingSelectRow>();

    if (error) throw new Error(error.message);
    if (!data) return null;

    return {
      id: data.id,
      promo_code: data.promo_code ?? null,
      full_name: data.full_name ?? null,
      phone_number: data.phone_number ?? null,
      attempts_left: toInt(data.attempts_left),
      max_attempts: toInt(data.max_attempts),
      validity_end_at: data.validity_end_at ?? null,
      end_at: data.end_at ?? null,
    };
  };

  const loadAttendanceHistory = async (code: string): Promise<void> => {
    const c = normalizeCode(code);
    if (!c) {
      setAttHistory([]);
      return;
    }

    try {
      setAttLookupBusy(true);

      const booking = await lookupBookingByCode(c);
      if (!booking || !booking.id) {
        setAttHistory([]);
        return;
      }

      const { data, error } = await supabase
        .from("promo_booking_attendance")
        .select("id, created_at, promo_booking_id, local_day, in_at, out_at, auto_out, note")
        .eq("promo_booking_id", booking.id)
        .order("local_day", { ascending: false })
        .limit(10);

      if (error) {
        setAttHistory([]);
        return;
      }

      setAttHistory((data ?? []) as PromoBookingAttendanceLogRow[]);
    } catch {
      setAttHistory([]);
    } finally {
      setAttLookupBusy(false);
    }
  };

  const submitAttendance = async (): Promise<void> => {
    const c = normalizeCode(codeInput);
    if (!c) return showAlert("Required", "Input promo code first.");

    try {
      setAttBusy(true);

      const booking = await lookupBookingByCode(c);
      if (!booking || !booking.id) {
        setAttBusy(false);
        return showAlert("Not Found", "No promo booking found for that code.");
      }

      // validity check (prefer validity_end_at, fallback end_at)
      const expiryIso = booking.validity_end_at ?? booking.end_at ?? null;
      if (expiryIso && isExpiredIso(expiryIso)) {
        setAttBusy(false);
        return showAlert("Expired", "This promo code is already expired.");
      }

      const customerLabel = `${booking.full_name ?? "Customer"}${booking.phone_number ? ` • ${booking.phone_number}` : ""}`;

      const today = manilaLocalDay();
      const nowIso = new Date().toISOString();

      const attemptsLeft = typeof booking.attempts_left === "number" ? booking.attempts_left : null;

      if (attAction === "in") {
        if (attemptsLeft !== null && attemptsLeft <= 0) {
          setAttBusy(false);
          return showAlert("No Attempts", "This promo code has no remaining attempts.");
        }

        const { error: insErr } = await supabase.from("promo_booking_attendance").insert({
          promo_booking_id: booking.id,
          local_day: today,
          in_at: nowIso,
          out_at: null,
          auto_out: false,
          note: attNote.trim() ? attNote.trim() : null,
        });

        if (insErr) {
          const msg = insErr.message.toLowerCase();
          if (msg.includes("unique") || msg.includes("duplicate key")) {
            setAttBusy(false);
            return showAlert("Already IN", "This code is already checked-in today.");
          }
          setAttBusy(false);
          return showAlert("Error", insErr.message);
        }

        // decrement attempts_left
        if (attemptsLeft !== null) {
          const nextAttempts = Math.max(0, attemptsLeft - 1);
          await supabase.from("promo_bookings").update({ attempts_left: nextAttempts }).eq("id", booking.id);
        }

        setAttBusy(false);
        setAttNote("");
        showAlert("Saved", `Attendance "IN" saved.\n\n${customerLabel}`);
        void loadAttendanceHistory(c);
        return;
      }

      // OUT
      const { data: upd, error: upErr } = await supabase
        .from("promo_booking_attendance")
        .update({ out_at: nowIso, auto_out: false, note: attNote.trim() ? attNote.trim() : null })
        .eq("promo_booking_id", booking.id)
        .eq("local_day", today)
        .is("out_at", null)
        .select("id");

      if (upErr) {
        setAttBusy(false);
        return showAlert("Error", upErr.message);
      }

      const rows = (upd ?? []) as Array<{ id: string }>;
      if (rows.length === 0) {
        setAttBusy(false);
        return showAlert("No Open IN", "No open check-in found for today. Please IN first.");
      }

      setAttBusy(false);
      setAttNote("");
      showAlert("Saved", `Attendance "OUT" saved.\n\n${customerLabel}`);
      void loadAttendanceHistory(c);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Attendance save failed.";
      setAttBusy(false);
      showAlert("Error", msg);
    }
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="booking-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Promo</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose} disabled={loading || attBusy}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonAlert
          isOpen={alertOpen}
          header={alertHeader}
          message={alertMessage}
          buttons={["OK"]}
          onDidDismiss={() => {
            setAlertOpen(false);
            if (afterAlert === "close_after_save") {
              setAfterAlert("none");
              onClose();
            }
          }}
        />

        <div className="bookadd-card">
          {(loading || codeBusy) && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <IonSpinner />
              <span style={{ fontWeight: 800, color: "rgba(31,41,55,0.85)" }}>{codeBusy ? "Generating code..." : "Loading..."}</span>
            </div>
          )}

          <IonItem className="form-item">
            <IonLabel position="stacked">Full Name *</IonLabel>
            <IonInput value={fullName} onIonInput={(e) => setFullName(String(e.detail.value ?? ""))} />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Phone Number *</IonLabel>
            <IonInput
              type="tel"
              inputMode="tel"
              placeholder="09XXXXXXXXX"
              value={phoneNumber}
              onIonInput={(e) => setPhoneNumber(String(e.detail.value ?? ""))}
            />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Area</IonLabel>
            <IonSelect
              value={area}
              onIonChange={(e) => {
                const v: unknown = e.detail.value;
                setArea(isPackageArea(v) ? v : "common_area");
              }}
            >
              <IonSelectOption value="common_area">Common Area</IonSelectOption>
              <IonSelectOption value="conference_room">Conference Room</IonSelectOption>
            </IonSelect>
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Promo Package</IonLabel>
            <IonSelect
              value={packageId}
              placeholder={areaPackages.length ? "Select package" : "No packages for this area"}
              disabled={areaPackages.length === 0}
              onIonChange={(e) => setPackageId(String(e.detail.value ?? ""))}
            >
              {areaPackages.map((p) => (
                <IonSelectOption key={p.id} value={p.id}>
                  {p.title}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>

          {selectedPackage?.description ? <p style={{ marginTop: 10, opacity: 0.85, fontWeight: 700 }}>{selectedPackage.description}</p> : null}

          {amenitiesList.length > 0 ? (
            <IonCard className="promo-card" style={{ marginTop: 10 }}>
              <IonCardContent>
                <strong>AMENITIES</strong>
                <ul style={{ margin: "8px 0 0 18px" }}>
                  {amenitiesList.map((a, i) => (
                    <li key={`${a}-${i}`}>{a}</li>
                  ))}
                </ul>
              </IonCardContent>
            </IonCard>
          ) : null}

          <IonItem className="form-item">
            <IonLabel position="stacked">Duration / Price</IonLabel>
            <IonSelect
              value={optionId}
              placeholder={packageId ? "Select option" : "Select package first"}
              disabled={!packageId}
              onIonChange={(e) => setOptionId(String(e.detail.value ?? ""))}
            >
              {packageOptions.map((o) => (
                <IonSelectOption key={o.id} value={o.id}>
                  {o.option_name} • {formatDuration(Number(o.duration_value), o.duration_unit)} • ₱{toNum(o.price).toFixed(2)}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>

          {approxDaysFromOption(selectedOption) >= 7 ? (
            <IonCard className="promo-card" style={{ marginTop: 10 }}>
              <IonCardContent>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 900, letterSpacing: 0.5 }}>PROMO CODE</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Use this code for Attendance IN/OUT.</div>
                  </div>

                  <button className="receipt-btn" disabled={!promoCode} onClick={() => void copyText(promoCode)} style={{ whiteSpace: "nowrap" }}>
                    Copy
                  </button>
                </div>

                <div style={{ marginTop: 10 }}>
                  <input
                    className="reason-input"
                    value={promoCode}
                    readOnly
                    placeholder={codeBusy ? "Generating..." : "Code will appear here"}
                    style={{
                      width: "100%",
                      fontWeight: 900,
                      letterSpacing: 2,
                      textAlign: "center",
                      fontSize: 18,
                    }}
                  />
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="receipt-btn"
                    onClick={() => {
                      setPromoCode("");
                      void maybeGenerateCode();
                    }}
                    disabled={codeBusy}
                  >
                    Regenerate
                  </button>

                  <div style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>{isStaffLike ? "Created by Staff/Admin" : "Anonymous/Customer Mode"}</div>
                </div>
              </IonCardContent>
            </IonCard>
          ) : null}

          <IonItem className="form-item">
            <IonLabel position="stacked">Start Date & Time</IonLabel>
            <IonInput
              type="datetime-local"
              min={minLocalNow()}
              value={startIso ? isoToLocal(startIso) : ""}
              onIonInput={(e) => {
                const v = String(e.detail.value ?? "");
                setStartIso(v ? localToIso(v) : "");
              }}
            />
          </IonItem>

          {area === "common_area" ? (
            <IonItem className="form-item">
              <IonLabel position="stacked">Seat Number</IonLabel>
              <IonSelect
                value={seatNumber}
                placeholder={startIso && endIso ? (availableSeatOptions.length ? "Select seat" : "No available seats") : "Select date & time first"}
                disabled={!startIso || !endIso || availableSeatOptions.length === 0}
                onIonChange={(e) => setSeatNumber(String(e.detail.value ?? ""))}
              >
                {availableSeatOptions.map((s) => (
                  <IonSelectOption key={s.value} value={s.value}>
                    {s.label}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
          ) : null}

          <IonCard className="promo-card" style={{ marginTop: 12 }}>
            <IonCardContent>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ opacity: 0.85 }}>Total Amount</span>
                <strong>₱{totalAmount.toFixed(2)}</strong>
              </div>

              {selectedOption ? (
                <div style={{ marginTop: 8, opacity: 0.85, fontSize: 13 }}>
                  Duration: {formatDuration(Number(selectedOption.duration_value), selectedOption.duration_unit)}
                </div>
              ) : null}

              {endTimeLabel ? (
                <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                  Time End: <strong>{endTimeLabel}</strong>
                </div>
              ) : null}

              {statusPreview ? (
                <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                  Status: <strong>{statusPreview}</strong>
                </div>
              ) : null}
            </IonCardContent>
          </IonCard>

          <IonButton expand="block" className="promo-save-btn" style={{ marginTop: 12 }} disabled={loading || codeBusy} onClick={() => void submitPromo()}>
            Save Promo Booking
          </IonButton>

          <IonCard className="promo-card" style={{ marginTop: 14 }}>
            <IonCardContent>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>ATTENDANCE (IN / OUT)</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>Tap the button then enter code + select IN/OUT inside the modal.</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="receipt-btn" onClick={openAttendanceModal} disabled={attBusy}>
                  Enter Code
                </button>

                {promoCode ? (
                  <button
                    className="receipt-btn"
                    onClick={() => {
                      setCodeInput(promoCode);
                      setAttModalOpen(true);
                      void loadAttendanceHistory(promoCode);
                    }}
                  >
                    Use Generated Code
                  </button>
                ) : null}
              </div>
            </IonCardContent>
          </IonCard>
        </div>

        {attModalOpen && (
          <div className="receipt-overlay" onClick={closeAttendanceModal}>
            <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
              <h3 className="receipt-title">ATTENDANCE</h3>
              <p className="receipt-subtitle">
                Enter Promo Code • Select IN/OUT • Manila Day: <b>{manilaLocalDay()}</b>
              </p>

              <hr />

              <div className="receipt-row">
                <span>Promo Code</span>
                <input
                  className="money-input"
                  value={codeInput}
                  placeholder="e.g. AB23CD45"
                  onChange={(e) => {
                    const v = normalizeCode(e.currentTarget.value);
                    setCodeInput(v);
                  }}
                  onBlur={() => void loadAttendanceHistory(codeInput)}
                  disabled={attBusy}
                />
              </div>

              <div className="receipt-row">
                <span>Action</span>
                <select value={attAction} onChange={(e) => setAttAction(String(e.currentTarget.value) === "out" ? "out" : "in")} disabled={attBusy}>
                  <option value="in">IN</option>
                  <option value="out">OUT</option>
                </select>
              </div>

              <div className="receipt-row" style={{ alignItems: "flex-start" }}>
                <span style={{ paddingTop: 6 }}>Note</span>
                <textarea
                  className="reason-input"
                  style={{ width: "100%", minHeight: 90, resize: "vertical" }}
                  value={attNote}
                  onChange={(e) => setAttNote(e.currentTarget.value)}
                  placeholder="Optional note..."
                  disabled={attBusy}
                />
              </div>

              <div className="modal-actions">
                <button className="receipt-btn" onClick={closeAttendanceModal} disabled={attBusy}>
                  Close
                </button>

                <button className="receipt-btn" onClick={() => void loadAttendanceHistory(codeInput)} disabled={attLookupBusy || attBusy}>
                  {attLookupBusy ? "Loading..." : "Load History"}
                </button>

                <button className="receipt-btn" onClick={() => void submitAttendance()} disabled={attBusy}>
                  {attBusy ? "Saving..." : "Save"}
                </button>
              </div>

              <hr />

              <div style={{ fontWeight: 900, marginBottom: 8 }}>Recent Logs</div>

              {attLookupBusy ? (
                <div style={{ fontSize: 12, opacity: 0.8 }}>Loading...</div>
              ) : attHistory.length === 0 ? (
                <div style={{ fontSize: 12, opacity: 0.8 }}>No logs found.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {attHistory.map((h) => {
                    const inTxt = h.in_at ? new Date(h.in_at).toLocaleString("en-PH") : "—";
                    const outTxt = h.out_at ? new Date(h.out_at).toLocaleString("en-PH") : "—";
                    return (
                      <div
                        key={h.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: 10,
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 1000 }}>
                            Day {h.local_day} • {h.out_at ? "OUT" : "IN"}
                            {h.auto_out ? <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>(AUTO OUT)</span> : null}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                            IN: <b>{inTxt}</b>
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                            OUT: <b>{outTxt}</b>
                          </div>
                          {h.note ? <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>Note: {h.note}</div> : null}
                        </div>
                        <div style={{ fontWeight: 900, opacity: 0.8, whiteSpace: "nowrap" }}>BOOKING</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

export default PromoModal;
