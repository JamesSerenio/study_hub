// src/components/PromoModal.tsx
// ✅ STRICT TS
// ✅ NO any
// ✅ Required/errors/success = IonAlert modal only
// ✅ Uses seat_blocked_times (EXCLUDE overlap) to block seats/conference after saving promo
// ✅ Friendly overlap modal when seat_blocked_times_no_overlap hit
// ✅ After success OK: closes THIS promo modal only
// ✅ THEMED: className="booking-modal" + bookadd-card + form-item
// ✅ NEW: Phone Number required + 09 + exactly 11 digits
// ✅ NEW: If promo duration >= 7 days => auto-generate PROMO CODE
// ✅ NEW: Save promo_code + created_by_staff_id (if staff/admin logged in)
// ✅ NEW: Attendance IN/OUT by input code (same modal) => insert to promo_attendance
// ✅ NEW (YOUR REQUEST): Attendance UI moved to a BEAUTIFUL overlay modal (same as Staff_Consignment_Record)
//     - Click button "Enter Code (Attendance)"
//     - Choose IN/OUT first, then input code
//     - Uses receipt-* classnames (receipt-overlay / receipt-container / receipt-btn / money-input)

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

type PromoBookingCodeLookupRow = {
  id: string;
  promo_code: string | null;
  full_name: string;
  phone_number: string | null;
};

type PromoAttendanceRow = {
  id: string;
  created_at: string;
  promo_code: string;
  action: "in" | "out";
  staff_id: string | null;
  note: string | null;
};

const isPackageArea = (v: unknown): v is PackageArea =>
  v === "common_area" || v === "conference_room";

/* ================= HELPERS ================= */

const toNum = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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
  return (
    m.includes("seat_blocked_times_no_overlap") ||
    (m.includes("duplicate key") === false && m.includes("exclusion constraint"))
  );
};

/** convert option duration to "approx days" for threshold check */
const approxDaysFromOption = (opt: PackageOptionRow | null): number => {
  if (!opt) return 0;
  const v = Number(opt.duration_value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (opt.duration_unit === "hour") return 0;
  if (opt.duration_unit === "day") return v;
  if (opt.duration_unit === "month") return v * 30;
  return v * 365; // year
};

const randomCode = (len: number): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing O/0/I/1
  let out = "";
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const normalizeCode = (v: string): string =>
  String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();

/* ================= COMPONENT ================= */

const PromoModal: React.FC<PromoModalProps> = ({ isOpen, onClose, onSaved, seatGroups }) => {
  const [loading, setLoading] = useState<boolean>(false);

  // ✅ One alert modal for: required + errors + success
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

  // ================= role/staff detection =================
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

  // promo code state (generated if >= 7 days)
  const [promoCode, setPromoCode] = useState<string>("");
  const [codeBusy, setCodeBusy] = useState<boolean>(false);

  /* =========================
     ✅ NEW: ATTENDANCE MODAL (receipt style)
  ========================= */
  const [attModalOpen, setAttModalOpen] = useState<boolean>(false);
  const [attStep, setAttStep] = useState<1 | 2>(1); // 1 choose action, 2 enter code
  const [attAction, setAttAction] = useState<"in" | "out">("in");
  const [codeInput, setCodeInput] = useState<string>("");
  const [attNote, setAttNote] = useState<string>("");
  const [attBusy, setAttBusy] = useState<boolean>(false);
  const [attLookupBusy, setAttLookupBusy] = useState<boolean>(false);
  const [attHistory, setAttHistory] = useState<PromoAttendanceRow[]>([]);

  const openAttendanceModal = (): void => {
    setAttModalOpen(true);
    setAttStep(1);
    setAttAction("in");
    setCodeInput("");
    setAttNote("");
    setAttHistory([]);
  };

  const closeAttendanceModal = (): void => {
    if (attBusy) return;
    setAttModalOpen(false);
    setAttStep(1);
  };

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

  // ================= generate unique promo code =================
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

  // load packages/options + reset fields on open
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
      setCodeInput("");
      setAttAction("in");
      setAttNote("");
      setAttHistory([]);
      setAttModalOpen(false);
      setAttStep(1);

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

      const opRes = await supabase
        .from("package_options")
        .select("id, package_id, option_name, duration_value, duration_unit, price")
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

  // update blocked seats when schedule changes
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

  // conference auto warning
  useEffect(() => {
    if (!isOpen) return;
    if (area !== "conference_room") return;
    if (!startIso || !endIso) return;
    if (!conferenceBlocked) return;

    showAlert("Not Available", "Conference room is not available for the selected schedule.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, area, startIso, endIso, conferenceBlocked]);

  // when option changes, if >=7 days generate code
  useEffect(() => {
    if (!isOpen) return;
    void maybeGenerateCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, optionId]);

  // create seat block row after promo save
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

    const needCode = approxDaysFromOption(selectedOption) >= 7;
    let finalCode: string | null = null;

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

      const blockRes = await createSeatBlock({ userId, area, seatNumber, startIso, endIso });
      if (!blockRes.ok) {
        setLoading(false);
        return showAlert("Not Available", blockRes.message ?? "Not available.");
      }

      setLoading(false);

      if (needCode && (finalCode ?? promoCode)) {
        showAlert(
          "Saved",
          `Promo booking saved successfully.\n\nCODE: ${(finalCode ?? promoCode) as string}\n\nUse this code for attendance IN/OUT.`,
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

  /* =========================
     ATTENDANCE: history + submit (by code)
  ========================= */

  const loadAttendanceHistory = async (code: string): Promise<void> => {
    const c = normalizeCode(code);
    if (!c) {
      setAttHistory([]);
      return;
    }
    try {
      setAttLookupBusy(true);
      const { data, error } = await supabase
        .from("promo_attendance")
        .select("id, created_at, promo_code, action, staff_id, note")
        .eq("promo_code", c)
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) {
        setAttHistory([]);
        return;
      }
      setAttHistory((data ?? []) as PromoAttendanceRow[]);
    } finally {
      setAttLookupBusy(false);
    }
  };

  const submitAttendance = async (): Promise<void> => {
    const c = normalizeCode(codeInput);
    if (!c) return showAlert("Required", "Please input promo code.");

    try {
      setAttBusy(true);

      const { data: booking, error: bErr } = await supabase
        .from("promo_bookings")
        .select("id, promo_code, full_name, phone_number")
        .eq("promo_code", c)
        .maybeSingle();

      if (bErr) {
        setAttBusy(false);
        return showAlert("Error", bErr.message);
      }
      if (!booking) {
        setAttBusy(false);
        return showAlert("Not Found", "No promo booking found for that code.");
      }

      const userRes = await supabase.auth.getUser();
      const staffId = userRes.data.user?.id ?? null;

      const payload = {
        promo_booking_id: (booking as PromoBookingCodeLookupRow).id,
        promo_code: c,
        action: attAction,
        staff_id: staffId,
        note: attNote.trim() || null,
      };

      const { error: insErr } = await supabase.from("promo_attendance").insert(payload);
      if (insErr) {
        setAttBusy(false);
        return showAlert("Error", insErr.message);
      }

      setAttBusy(false);
      setAttNote("");

      showAlert(
        "Saved",
        `Attendance "${attAction.toUpperCase()}" saved.\n\nCustomer: ${(booking as PromoBookingCodeLookupRow).full_name}`
      );

      await loadAttendanceHistory(c);
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
              <span style={{ fontWeight: 800, color: "rgba(31,41,55,0.85)" }}>
                {codeBusy ? "Generating code..." : "Loading..."}
              </span>
            </div>
          )}

          {/* Full Name */}
          <IonItem className="form-item">
            <IonLabel position="stacked">Full Name *</IonLabel>
            <IonInput value={fullName} onIonInput={(e) => setFullName(String(e.detail.value ?? ""))} />
          </IonItem>

          {/* Phone */}
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

          {selectedPackage?.description ? (
            <p style={{ marginTop: 10, opacity: 0.85, fontWeight: 700 }}>{selectedPackage.description}</p>
          ) : null}

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
                  {o.option_name} • {formatDuration(Number(o.duration_value), o.duration_unit)} • ₱
                  {toNum(o.price).toFixed(2)}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>

          {/* GENERATED CODE */}
          {approxDaysFromOption(selectedOption) >= 7 ? (
            <IonCard className="promo-card" style={{ marginTop: 10 }}>
              <IonCardContent>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 900, letterSpacing: 0.5 }}>PROMO CODE</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Use this code for Attendance IN/OUT.</div>
                  </div>

                  <button
                    className="receipt-btn"
                    disabled={!promoCode}
                    onClick={() => void copyText(promoCode)}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    Copy
                  </button>
                </div>

                <div style={{ marginTop: 10 }}>
                  <input
                    className="money-input"
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

                  <div style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>
                    {isStaffLike ? "Created by Staff/Admin" : "Anonymous/Customer Mode"}
                  </div>
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
                placeholder={
                  startIso && endIso
                    ? availableSeatOptions.length
                      ? "Select seat"
                      : "No available seats"
                    : "Select date & time first"
                }
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

          <IonButton
            expand="block"
            className="promo-save-btn"
            style={{ marginTop: 12 }}
            disabled={loading || codeBusy}
            onClick={() => void submitPromo()}
          >
            Save Promo Booking
          </IonButton>

          {/* ✅ NEW BUTTON: open Attendance modal (receipt style) */}
          <div style={{ marginTop: 10 }}>
            <button className="receipt-btn" onClick={openAttendanceModal} disabled={attBusy}>
              Enter Code (Attendance)
            </button>
          </div>
        </div>

        {/* =========================
            ✅ ATTENDANCE OVERLAY MODAL
            same style as Staff_Consignment_Record
        ========================= */}
        {attModalOpen && (
          <div className="receipt-overlay" onClick={closeAttendanceModal}>
            <div className="receipt-container" onClick={(e) => e.stopPropagation()}>
              <h3 className="receipt-title">ATTENDANCE</h3>
              <p className="receipt-subtitle">Choose IN/OUT then enter promo code.</p>

              <hr />

              {/* STEP 1: choose action */}
              {attStep === 1 ? (
                <>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Select Action</div>

                  <div className="receipt-row">
                    <span>Action</span>
                    <select
                      className="money-input"
                      value={attAction}
                      onChange={(e) => setAttAction(e.currentTarget.value === "out" ? "out" : "in")}
                      disabled={attBusy}
                      style={{ width: 180 }}
                    >
                      <option value="in">IN</option>
                      <option value="out">OUT</option>
                    </select>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
                    After selecting action, click <b>Next</b>.
                  </div>

                  <div className="modal-actions" style={{ marginTop: 16 }}>
                    <button className="receipt-btn" onClick={closeAttendanceModal} disabled={attBusy}>
                      Close
                    </button>
                    <button
                      className="receipt-btn"
                      onClick={() => setAttStep(2)}
                      disabled={attBusy}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* STEP 2: input code + note */}
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>
                    Action: <span style={{ opacity: 0.9 }}>{attAction.toUpperCase()}</span>
                  </div>

                  <div className="receipt-row">
                    <span>Promo Code</span>
                    <input
                      className="money-input"
                      value={codeInput}
                      placeholder="e.g. AB23CD45"
                      onChange={(e) => setCodeInput(normalizeCode(e.currentTarget.value))}
                      disabled={attBusy}
                    />
                  </div>

                  <div className="receipt-row" style={{ marginTop: 8 }}>
                    <span>Note</span>
                    <input
                      className="money-input"
                      value={attNote}
                      placeholder="optional"
                      onChange={(e) => setAttNote(e.currentTarget.value)}
                      disabled={attBusy}
                    />
                  </div>

                  {/* quick use generated code */}
                  {promoCode ? (
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="receipt-btn"
                        onClick={() => {
                          const c = promoCode;
                          setCodeInput(c);
                          void loadAttendanceHistory(c);
                        }}
                        disabled={attBusy}
                      >
                        Use Generated Code
                      </button>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="receipt-btn"
                      onClick={() => void loadAttendanceHistory(codeInput)}
                      disabled={attLookupBusy || attBusy}
                    >
                      {attLookupBusy ? "Loading..." : "Load History"}
                    </button>

                    <button className="receipt-btn" onClick={() => void submitAttendance()} disabled={attBusy}>
                      {attBusy ? "Saving..." : "Save Attendance"}
                    </button>
                  </div>

                  {/* history */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>Recent Logs</div>

                    {attLookupBusy ? (
                      <div style={{ fontSize: 13, opacity: 0.8 }}>Loading...</div>
                    ) : attHistory.length === 0 ? (
                      <div style={{ fontSize: 13, opacity: 0.8 }}>No logs found.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {attHistory.map((h) => (
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
                                {String(h.action).toUpperCase()} •{" "}
                                {new Date(h.created_at).toLocaleString("en-PH")}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                                Code: <b>{h.promo_code}</b>
                              </div>
                              {h.note ? (
                                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                                  Note: {h.note}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="modal-actions" style={{ marginTop: 16 }}>
                    <button className="receipt-btn" onClick={() => setAttStep(1)} disabled={attBusy}>
                      Back
                    </button>
                    <button className="receipt-btn" onClick={closeAttendanceModal} disabled={attBusy}>
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

export default PromoModal;
