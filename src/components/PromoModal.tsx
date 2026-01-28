// src/components/PromoModal.tsx
// ✅ STRICT TS
// ✅ NO any
// ✅ Required/errors/success = IonAlert modal only
// ✅ Conference overlap (promo_no_overlap_conference) = friendly modal
// ✅ After success OK: closes THIS promo modal only (does NOT trigger parent "Thank you" unless your parent onSaved() shows it)
// ✅ THEMED: className="booking-modal" + bookadd-card + form-item (same as Booking)

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
  source: "promo" | "regular" | string;
};

const isPackageArea = (v: unknown): v is PackageArea =>
  v === "common_area" || v === "conference_room";

/* ================= HELPERS ================= */

const toNum = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return v;
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

const computeStatus = (
  startIso: string,
  endIso: string
): "upcoming" | "ongoing" | "finished" => {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "upcoming";
  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "ongoing";
  return "finished";
};

/** Overlap rule: existing.start < new.end AND existing.end > new.start */
const checkPromoAvailability = async (params: {
  area: PackageArea;
  seatNumber: string;
  startIso: string;
  endIso: string;
}): Promise<{ ok: boolean; message?: string }> => {
  const { area, seatNumber, startIso, endIso } = params;

  // promo_bookings conflicts
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

  // customer_sessions conflicts
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

  const [fullName, setFullName] = useState<string>("");
  const [area, setArea] = useState<PackageArea>("common_area");
  const [packageId, setPackageId] = useState<string>("");
  const [optionId, setOptionId] = useState<string>("");
  const [seatNumber, setSeatNumber] = useState<string>("");
  const [startIso, setStartIso] = useState<string>("");

  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [options, setOptions] = useState<PackageOptionRow[]>([]);

  const [occupiedSeats, setOccupiedSeats] = useState<string[]>([]);
  const [conferenceBlocked, setConferenceBlocked] = useState<boolean>(false);

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

  // load packages/options + reset fields on open
  useEffect(() => {
    if (!isOpen) return;

    const load = async (): Promise<void> => {
      setLoading(true);

      setFullName("");
      setArea("common_area");
      setPackageId("");
      setOptionId("");
      setSeatNumber("");
      setStartIso("");
      setOccupiedSeats([]);
      setConferenceBlocked(false);

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
  }, [area]);

  useEffect(() => {
    setOptionId("");
    setSeatNumber("");
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

  const submitPromo = async (): Promise<void> => {
    const name = fullName.trim();

    if (!name) return showAlert("Required", "Full name is required.");
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

    setLoading(true);

    const availability = await checkPromoAvailability({ area, seatNumber, startIso, endIso });
    if (!availability.ok) {
      setLoading(false);
      return showAlert("Not Available", availability.message ?? "Not available.");
    }

    const userRes = await supabase.auth.getUser();
    const userId = userRes.data.user?.id ?? null;

    const payload = {
      user_id: userId,
      full_name: name,
      area,
      package_id: selectedPackage.id,
      package_option_id: selectedOption.id,
      seat_number: area === "common_area" ? seatNumber : null,
      start_at: startIso,
      end_at: endIso,
      price: toNum(selectedOption.price),
      status: computeStatus(startIso, endIso),
    };

    const ins = await supabase.from("promo_bookings").insert(payload);

    if (ins.error) {
      setLoading(false);

      if (isConferenceOverlapConstraint(ins.error.message)) {
        return showAlert("Not Available", "Conference room is not available for the selected schedule.");
      }

      return showAlert("Error", ins.error.message);
    }

    setLoading(false);

    onSaved(); // refresh only
    showAlert("Saved", "Promo booking saved successfully.", "close_after_save");
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="booking-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Promo</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose} disabled={loading}>
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
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <IonSpinner />
              <span style={{ fontWeight: 800, color: "rgba(31,41,55,0.85)" }}>Loading...</span>
            </div>
          )}

          <IonItem className="form-item">
            <IonLabel position="stacked">Full Name</IonLabel>
            <IonInput value={fullName} onIonInput={(e) => setFullName(String(e.detail.value ?? ""))} />
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
            <p style={{ marginTop: 10, opacity: 0.85, fontWeight: 700 }}>
              {selectedPackage.description}
            </p>
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
            disabled={loading}
            onClick={() => void submitPromo()}
          >
            Save Promo Booking
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
};

export default PromoModal;
