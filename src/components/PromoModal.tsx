// src/components/PromoModal.tsx
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
  IonText,
  IonCard,
  IonCardContent,
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
  onSaved: () => void;
  seatGroups: SeatGroup[];
}

/* ================= HELPERS ================= */

const toNum = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

// "YYYY-MM-DDTHH:mm" (local) -> ISO (UTC)
const localToIso = (v: string): string => new Date(v).toISOString();

// ISO -> "YYYY-MM-DDTHH:mm" (local)
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

const formatArea = (a: PackageArea): string => (a === "common_area" ? "Common Area" : "Conference Room");

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

/* ================= COMPONENT ================= */

const PromoModal: React.FC<PromoModalProps> = ({ isOpen, onClose, onSaved, seatGroups }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");

  // customer inputs
  const [fullName, setFullName] = useState<string>("");
  const [area, setArea] = useState<PackageArea>("common_area");
  const [packageId, setPackageId] = useState<string>("");
  const [optionId, setOptionId] = useState<string>("");
  const [seatNumber, setSeatNumber] = useState<string>("");
  const [startIso, setStartIso] = useState<string>("");

  // data from admin (packages/options)
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [options, setOptions] = useState<PackageOptionRow[]>([]);

  const allSeats = useMemo<{ label: string; value: string }[]>(() => {
    const list: { label: string; value: string }[] = [];
    seatGroups.forEach((g) => {
      g.seats.forEach((s) => list.push({ label: `${g.title} - Seat ${s}`, value: s }));
    });
    return list;
  }, [seatGroups]);

  // only active packages
  const activePackages = useMemo<PackageRow[]>(() => packages.filter((p) => p.is_active), [packages]);

  // packages filtered by chosen area
  const areaPackages = useMemo<PackageRow[]>(() => activePackages.filter((p) => p.area === area), [activePackages, area]);

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

  const amenitiesList = useMemo<string[]>(() => parseAmenities(selectedPackage?.amenities ?? null), [selectedPackage]);

  const totalAmount = useMemo<number>(() => {
    if (!selectedOption) return 0;
    return Number(toNum(selectedOption.price).toFixed(2));
  }, [selectedOption]);

  const endTimeLabel = useMemo<string>(() => {
    if (!selectedOption || !startIso) return "";
    const endIso = computeEndIso(startIso, selectedOption);
    return new Date(endIso).toLocaleString("en-PH");
  }, [selectedOption, startIso]);

  /* ================= LOAD ================= */

  useEffect(() => {
    if (!isOpen) return;

    const load = async (): Promise<void> => {
      setLoading(true);
      setErr("");

      // reset customer form
      setFullName("");
      setArea("common_area");
      setPackageId("");
      setOptionId("");
      setSeatNumber("");
      setStartIso("");

      const pkRes = await supabase
        .from("packages")
        .select("id, area, title, description, amenities, is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (pkRes.error) {
        setPackages([]);
        setOptions([]);
        setErr(pkRes.error.message);
        setLoading(false);
        return;
      }

      const opRes = await supabase
        .from("package_options")
        .select("id, package_id, option_name, duration_value, duration_unit, price")
        .order("created_at", { ascending: true });

      if (opRes.error) {
        setPackages((pkRes.data as PackageRow[]) ?? []);
        setOptions([]);
        setErr(opRes.error.message);
        setLoading(false);
        return;
      }

      setPackages(((pkRes.data as PackageRow[]) ?? []) as PackageRow[]);
      setOptions(((opRes.data as PackageOptionRow[]) ?? []) as PackageOptionRow[]);
      setLoading(false);
    };

    void load();
  }, [isOpen]);

  // if area changes: reset package/option/seat
  useEffect(() => {
    setPackageId("");
    setOptionId("");
    setSeatNumber("");
  }, [area]);

  // if package changes: reset option/seat
  useEffect(() => {
    setOptionId("");
    setSeatNumber("");
  }, [packageId]);

  /* ================= SUBMIT ================= */

  const submitPromo = async (): Promise<void> => {
    setErr("");

    const name = fullName.trim();
    if (!name) {
      setErr("Full name is required.");
      return;
    }
    if (!area) {
      setErr("Select area.");
      return;
    }
    if (!selectedPackage) {
      setErr("Select promo package.");
      return;
    }
    if (!selectedOption) {
      setErr("Select duration/price option.");
      return;
    }
    if (!startIso) {
      setErr("Select start date & time.");
      return;
    }

    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs) || startMs < Date.now()) {
      setErr("Start time must be today or later.");
      return;
    }

    if (area === "common_area" && !seatNumber) {
      setErr("Seat number is required for Common Area.");
      return;
    }

    setLoading(true);

    const userRes = await supabase.auth.getUser();
    const uid = userRes.data.user?.id ?? null;

    if (userRes.error) {
      setLoading(false);
      setErr(userRes.error.message);
      return;
    }

    // NOTE: requires promo_bookings table
    const payload = {
      user_id: uid,
      full_name: name,
      area: area,
      package_id: selectedPackage.id,
      package_option_id: selectedOption.id,
      seat_number: area === "common_area" ? seatNumber : null,
      start_at: startIso,
      end_at: computeEndIso(startIso, selectedOption),
      price: toNum(selectedOption.price),
      status: "pending",
      created_at: new Date().toISOString(),
    };

    const ins = await supabase.from("promo_bookings").insert(payload);

    if (ins.error) {
      setLoading(false);
      setErr(ins.error.message);
      return;
    }

    setLoading(false);
    onSaved();
    onClose();
  };

  /* ================= UI ================= */

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
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
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <IonSpinner />
            <span>Loading...</span>
          </div>
        )}

        {err && (
          <IonText color="danger">
            <p style={{ marginTop: 0 }}>{err}</p>
          </IonText>
        )}

        <IonItem>
          <IonLabel position="stacked">Full Name</IonLabel>
          <IonInput value={fullName} onIonInput={(e) => setFullName(String(e.detail.value ?? ""))} />
        </IonItem>

        {/* ✅ choose area first */}
        <IonItem>
          <IonLabel position="stacked">Area</IonLabel>
          <IonSelect value={area} onIonChange={(e) => setArea(e.detail.value as PackageArea)}>
            <IonSelectOption value="common_area">Common Area</IonSelectOption>
            <IonSelectOption value="conference_room">Conference Room</IonSelectOption>
          </IonSelect>
        </IonItem>

        {/* ✅ packages from admin, filtered by area */}
        <IonItem>
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
          <IonText>
            <p style={{ marginTop: 10, opacity: 0.85 }}>{selectedPackage.description}</p>
          </IonText>
        ) : null}

        {amenitiesList.length > 0 ? (
          <IonCard style={{ marginTop: 10 }}>
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

        {/* ✅ options are admin-defined (duration + price) */}
        <IonItem>
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

        {/* ✅ calendar/time started */}
        <IonItem>
          <IonLabel position="stacked">Start Date & Time</IonLabel>
          <IonInput
            type="datetime-local"
            min={minLocalNow()}
            value={startIso ? isoToLocal(startIso) : ""}
            onIonInput={(e) => {
              const v = String(e.detail.value ?? "");
              if (!v) {
                setStartIso("");
                return;
              }
              setStartIso(localToIso(v));
            }}
          />
        </IonItem>

        {/* ✅ seat number only for common_area */}
        {area === "common_area" ? (
          <IonItem>
            <IonLabel position="stacked">Seat Number</IonLabel>
            <IonSelect value={seatNumber} placeholder="Select seat" onIonChange={(e) => setSeatNumber(String(e.detail.value ?? ""))}>
              {allSeats.map((s) => (
                <IonSelectOption key={s.value} value={s.value}>
                  {s.label}
                </IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
        ) : null}

        {/* ✅ total amount */}
        <IonCard style={{ marginTop: 12 }}>
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
                Valid until: <strong>{endTimeLabel}</strong>
              </div>
            ) : null}
          </IonCardContent>
        </IonCard>

        {/* ✅ apply/submit */}
        <IonButton expand="block" style={{ marginTop: 12 }} disabled={loading} onClick={() => void submitPromo()}>
          Apply / Submit
        </IonButton>
      </IonContent>
    </IonModal>
  );
};

export default PromoModal;
