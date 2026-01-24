// src/components/BookingModal.tsx
// ✅ FIX: Seat availability now checks BOTH promo_bookings and customer_sessions via seat_blocked_times view
// ✅ FIX: multi-seat "1, 13" handled by the view (one seat per row)
// ✅ FIX: reservation overlap uses correct condition: start < end AND end > start
// ✅ NO "any" usage (typed rows + typed events)

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
  IonToggle,
  IonDatetime,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import type {
  IonInputCustomEvent,
  InputInputEventDetail,
  InputChangeEventDetail,
} from "@ionic/core";

const HOURLY_RATE = 20;
const FREE_MINUTES = 5;

type CustomerType = "reviewer" | "student" | "regular" | "";

interface CustomerForm {
  full_name: string;
  customer_type: CustomerType;
  customer_field: string;
  has_id: boolean;
  id_number: string;
  seat_number: string[];
  reservation: boolean;
  reservation_date?: string;
  time_started: string;
}

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  seatGroups: SeatGroup[];
};

const isCustomerType = (v: unknown): v is CustomerType =>
  v === "" || v === "reviewer" || v === "student" || v === "regular";

type SeatBlockedRow = {
  seat_number: string;
  start_at: string;
  end_at: string;
  source: "promo" | "regular" | string;
};

type SeatConflictRow = { seat_number: string };

const formatTime12 = (hour24: number, minute: number): string => {
  const isPM = hour24 >= 12;
  let h12 = hour24 % 12;
  if (h12 === 0) h12 = 12;
  const hh = h12.toString().padStart(2, "0");
  const mm = minute.toString().padStart(2, "0");
  return `${hh}:${mm} ${isPM ? "pm" : "am"}`;
};

const normalizeTimeShortcut = (raw: string): string | null => {
  const v = raw.trim().toLowerCase().replace(/\s+/g, "");

  let m = v.match(/^(\d{1,2})(am|pm)$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h < 1 || h > 12) return null;
    return `${h.toString().padStart(2, "0")}:00 ${m[2]}`;
  }

  m = v.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 1 || h > 12) return null;
    if (mm < 0 || mm > 59) return null;
    return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")} ${m[3]}`;
  }

  m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 0 || h > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return formatTime12(h, mm);
  }

  m = v.match(/^(\d{3,4})$/);
  if (m) {
    const s = m[1].padStart(4, "0");
    const h = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2), 10);
    if (h < 0 || h > 23) return null;
    if (mm < 0 || mm > 59) return null;
    return formatTime12(h, mm);
  }

  return null;
};

const parseTimeToISO = (timeInput: string, dateIsoOrDate: string): string | null => {
  const match = timeInput.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3].toLowerCase();

  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  const base = new Date(dateIsoOrDate);
  if (!Number.isFinite(base.getTime())) return null;

  base.setHours(hour, minute, 0, 0);
  return base.toISOString();
};

const normalizeTimeAvail = (value: string): string | null => {
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9:]/g, "");

  if (!raw) return null;

  let m = raw.match(/^(\d{1,8}):(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
    if (h < 0) return null;
    if (mm < 0 || mm > 59) return null;
    if (h === 0 && mm === 0) return null;
    return `${h.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
  }

  m = raw.match(/^(\d{1,8})$/);
  if (m) {
    const digits = m[1];

    if (digits.length === 3 || digits.length === 4) {
      const s = digits.padStart(4, "0");
      const hh = parseInt(s.slice(0, 2), 10);
      const mm = parseInt(s.slice(2), 10);
      if (mm <= 59) {
        if (hh === 0 && mm === 0) return null;
        return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`;
      }
    }

    const h = parseInt(digits, 10);
    if (!Number.isFinite(h) || h <= 0) return null;
    return `${h.toString().padStart(2, "0")}:00`;
  }

  return null;
};

const toHHMM = (totalMinutes: number): string => {
  const mins = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

export default function BookingModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [form, setForm] = useState<CustomerForm>({
    full_name: "",
    customer_type: "",
    customer_field: "",
    has_id: false,
    id_number: "",
    seat_number: [],
    reservation: false,
    reservation_date: undefined,
    time_started: new Date().toISOString(),
  });

  const [occupiedSeats, setOccupiedSeats] = useState<string[]>([]);
  const [openTime, setOpenTime] = useState(false);

  const [timeAvail, setTimeAvail] = useState("00:00");
  const [timeAvailInput, setTimeAvailInput] = useState("00:00");

  const [timeStartedInput, setTimeStartedInput] = useState("00:00 am");
  const [timeSnapshotIso, setTimeSnapshotIso] = useState(new Date().toISOString());

  const commitTimeAvail = (rawValue: string) => {
    const normalized = normalizeTimeAvail(rawValue);
    if (normalized) {
      setTimeAvail(normalized);
      setTimeAvailInput(normalized);
    } else {
      setTimeAvailInput(rawValue);
    }
  };

  const getTotalMinutes = (): number => {
    const [hRaw, mRaw] = timeAvail.split(":");
    const h = Number(hRaw);
    const m = Number(mRaw);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0 || m > 59) return 0;
    return h * 60 + m;
  };

  const getAmountPeso = (): number => {
    const totalMin = getTotalMinutes();
    const billableMin = Math.max(0, totalMin - FREE_MINUTES);
    return (billableMin / 60) * HOURLY_RATE;
  };

  const addDuration = (startIso: string, durationHHMM: string): string => {
    const start = new Date(startIso);
    if (!Number.isFinite(start.getTime())) return startIso;

    const [hRaw, mRaw] = durationHHMM.split(":");
    const dh = Number(hRaw);
    const dm = Number(mRaw);
    if (Number.isNaN(dh) || Number.isNaN(dm)) return startIso;

    const totalMinutes = dh * 60 + dm;
    return new Date(start.getTime() + totalMinutes * 60_000).toISOString();
  };

  const getTimeEndedFrom = (startIso: string): string => {
    if (openTime) return startIso;
    return addDuration(startIso, timeAvail);
  };

  // ✅ Unified seat blocking (promo + regular)
  const fetchOccupiedSeats = async (startIso: string, endIso: string): Promise<void> => {
    const { data, error } = await supabase
      .from("seat_blocked_times")
      .select("seat_number, start_at, end_at, source")
      .lt("start_at", endIso)
      .gt("end_at", startIso);

    if (error) {
      console.error(error);
      setOccupiedSeats([]);
      return;
    }

    const rows = (data ?? []) as SeatBlockedRow[];
    const seats = rows.map((r) => String(r.seat_number).trim()).filter(Boolean);
    setOccupiedSeats(seats);
  };

  useEffect(() => {
    if (!isOpen) return;

    const snap = new Date().toISOString();
    setTimeSnapshotIso(snap);
    setForm((p) => ({ ...p, time_started: snap }));
    setTimeStartedInput("00:00 am");

    setTimeAvail("00:00");
    setTimeAvailInput("00:00");
    setOpenTime(false);

    const startIso = snap;
    const endIso = new Date(new Date(snap).getTime() + 60_000).toISOString(); // 1 minute window
    void fetchOccupiedSeats(startIso, endIso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let startIso = new Date().toISOString();
    if (form.reservation && form.reservation_date) {
      const normalized = normalizeTimeShortcut(timeStartedInput) ?? timeStartedInput;
      const parsed = parseTimeToISO(normalized, form.reservation_date);
      startIso = parsed ?? form.time_started;
    }

    let endIso: string;
    if (openTime) {
      endIso = new Date("2999-12-31T23:59:59.000Z").toISOString();
    } else {
      const computedEnd = getTimeEndedFrom(startIso);
      endIso =
        computedEnd === startIso
          ? new Date(new Date(startIso).getTime() + 60_000).toISOString()
          : computedEnd;
    }

    void fetchOccupiedSeats(startIso, endIso);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, form.reservation, form.reservation_date, openTime, timeStartedInput, timeAvail]);

  const formatPH = (d: Date) =>
    d.toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const summaryStartIso = useMemo(() => {
    if (!form.reservation) return timeSnapshotIso;
    if (form.reservation && form.reservation_date) {
      const normalized = normalizeTimeShortcut(timeStartedInput) ?? "12:00 am";
      const parsed = parseTimeToISO(normalized, form.reservation_date);
      return parsed ?? timeSnapshotIso;
    }
    return timeSnapshotIso;
  }, [form.reservation, form.reservation_date, timeStartedInput, timeSnapshotIso]);

  const summaryEndIso = useMemo(() => {
    if (openTime) return summaryStartIso;
    return getTimeEndedFrom(summaryStartIso);
  }, [openTime, summaryStartIso, timeAvail]);

  const totalMinutesPreview = getTotalMinutes();
  const totalHHMMPreview = toHHMM(totalMinutesPreview);
  const timeAmountPreview = openTime ? 0 : getAmountPeso();

  const timeInDisplay = formatPH(new Date(summaryStartIso));
  const timeOutDisplay = openTime ? "OPEN TIME" : formatPH(new Date(summaryEndIso));

  const handleSubmitBooking = async (): Promise<void> => {
    const trimmedName = form.full_name.trim();
    if (!trimmedName) return alert("Full Name is required.");
    if (form.seat_number.length === 0) return alert("Please select at least one seat.");
    if (form.reservation && !form.reservation_date) return alert("Please select a reservation date.");

    if (!openTime) {
      const normalized = normalizeTimeAvail(timeAvailInput);
      if (!normalized) return alert("Invalid Time Avail. Examples: 0:45 / 2 / 2:30 / 100:30 / 230");
      if (normalized === "00:00") return alert("Time Avail must be greater than 00:00.");
      setTimeAvail(normalized);
      setTimeAvailInput(normalized);
    }

    let startIsoToStore = new Date().toISOString();
    if (form.reservation) {
      const normalized = normalizeTimeShortcut(timeStartedInput);
      if (!normalized) {
        return alert('Please enter a valid Time Started (e.g., "2pm", "2:30pm", "14:00", "1400").');
      }
      const parsed = parseTimeToISO(normalized, form.reservation_date as string);
      if (!parsed) return alert("Invalid Time Started.");
      startIsoToStore = parsed;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return alert("You must be logged in to save records.");

    const dateToStore =
      form.reservation && form.reservation_date
        ? form.reservation_date.split("T")[0]
        : new Date().toISOString().split("T")[0];

    const timeEndedToStore = openTime
      ? new Date("2999-12-31T23:59:59.000Z").toISOString()
      : getTimeEndedFrom(startIsoToStore);

    // ✅ Final safety check (prevents double booking at save time)
    const { data: conflicts, error: conflictErr } = await supabase
      .from("seat_blocked_times")
      .select("seat_number")
      .in("seat_number", form.seat_number)
      .lt("start_at", timeEndedToStore)
      .gt("end_at", startIsoToStore);

    if (conflictErr) return alert(`Seat check error: ${conflictErr.message}`);

    const conflictSeats = (conflicts ?? [])
      .map((r: SeatConflictRow) => String(r.seat_number).trim())
      .filter(Boolean);

    if (conflictSeats.length > 0) {
      return alert(`Seat already taken: ${conflictSeats.join(", ")}`);
    }

    const totalMin = getTotalMinutes();
    const totalHoursForDB = Number((totalMin / 60).toFixed(2));
    const timeAmount = openTime ? 0 : getAmountPeso();

    const { error } = await supabase.from("customer_sessions").insert({
      staff_id: auth.user.id,
      date: dateToStore,
      full_name: trimmedName,
      customer_type: form.customer_type,
      customer_field: form.customer_field,
      has_id: form.has_id,
      id_number: form.id_number,
      hour_avail: openTime ? "OPEN" : timeAvail,
      time_started: startIsoToStore,
      time_ended: timeEndedToStore,
      total_time: openTime ? 0 : totalHoursForDB,
      total_amount: timeAmount,
      seat_number: form.seat_number.join(", "),
      reservation: form.reservation ? "yes" : "no",
      reservation_date: form.reservation_date,
    });

    if (error) return alert(`Error saving session: ${error.message}`);

    setForm({
      full_name: "",
      customer_type: "",
      customer_field: "",
      has_id: false,
      id_number: "",
      seat_number: [],
      reservation: false,
      reservation_date: undefined,
      time_started: new Date().toISOString(),
    });

    setTimeAvail("00:00");
    setTimeAvailInput("00:00");
    setTimeStartedInput("00:00 am");
    setOpenTime(false);

    onClose();
    onSaved();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Booking</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>
              <IonIcon icon={closeOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="bookadd-card">
          <IonItem className="form-item">
            <IonLabel>Open Time</IonLabel>
            <IonToggle checked={openTime} onIonChange={(e) => setOpenTime(e.detail.checked)} />
            <IonLabel slot="end">{openTime ? "Yes" : "No"}</IonLabel>
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Full Name *</IonLabel>
            <IonInput
              value={form.full_name}
              onIonChange={(e) => setForm({ ...form, full_name: e.detail.value ?? "" })}
              placeholder="Enter full name"
            />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Customer Type</IonLabel>
            <IonSelect
              value={form.customer_type}
              onIonChange={(e) => {
                const v: unknown = e.detail.value;
                setForm((prev) => ({ ...prev, customer_type: isCustomerType(v) ? v : "" }));
              }}
            >
              <IonSelectOption value="reviewer">Reviewer</IonSelectOption>
              <IonSelectOption value="student">Student</IonSelectOption>
              <IonSelectOption value="regular">Regular</IonSelectOption>
            </IonSelect>
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Customer Field</IonLabel>
            <IonInput
              value={form.customer_field}
              onIonChange={(e) => setForm({ ...form, customer_field: e.detail.value ?? "" })}
            />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel>ID</IonLabel>
            <IonToggle
              checked={form.has_id}
              onIonChange={(e) => setForm({ ...form, has_id: e.detail.checked })}
            />
            <IonLabel slot="end">{form.has_id ? "With" : "Without"}</IonLabel>
          </IonItem>

          {form.has_id && (
            <IonItem className="form-item">
              <IonLabel position="stacked">Specific ID</IonLabel>
              <IonInput
                value={form.id_number}
                placeholder="e.g., National ID, Student ID"
                onIonChange={(e) => setForm({ ...form, id_number: e.detail.value ?? "" })}
              />
            </IonItem>
          )}

          <IonItem className="form-item">
            <IonLabel>Reservation</IonLabel>
            <IonToggle
              checked={form.reservation}
              onIonChange={(e) => setForm({ ...form, reservation: e.detail.checked })}
            />
            <IonLabel slot="end">{form.reservation ? "Yes" : "No"}</IonLabel>
          </IonItem>

          {form.reservation && (
            <>
              <IonItem className="form-item">
                <IonLabel position="stacked">Reservation Date</IonLabel>
                <IonDatetime
                  presentation="date"
                  min={new Date().toISOString().split("T")[0]}
                  value={form.reservation_date}
                  onIonChange={(e) => {
                    const v = e.detail.value;
                    if (typeof v === "string") setForm({ ...form, reservation_date: v });
                  }}
                />
              </IonItem>

              <IonItem className="form-item">
                <IonLabel position="stacked">Time Started (Reservation)</IonLabel>
                <IonInput
                  value={timeStartedInput}
                  placeholder='e.g., "2pm" / "2:30pm" / "14:00" / "1400"'
                  onIonChange={(e) => setTimeStartedInput(e.detail.value ?? "")}
                  onIonBlur={() => {
                    const normalized = normalizeTimeShortcut(timeStartedInput);
                    setTimeStartedInput(normalized ?? "12:00 am");
                  }}
                />
              </IonItem>
            </>
          )}

          <IonItem className="form-item">
            <IonLabel position="stacked">Time Avail (HH:MM or hours)</IonLabel>
            <IonInput
              type="text"
              inputMode="text"
              placeholder='Examples: 0:45 / 2 / 2:30 / 100:30 / 230'
              value={timeAvailInput}
              disabled={openTime}
              onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => {
                setTimeAvailInput(e.detail.value ?? "");
              }}
              onIonBlur={() => commitTimeAvail(timeAvailInput)}
              onIonChange={(e: IonInputCustomEvent<InputChangeEventDetail>) => {
                const v = e.detail.value ?? "";
                setTimeAvailInput(v);
                commitTimeAvail(v);
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLIonInputElement>) => {
                if (e.key === "Enter") commitTimeAvail(timeAvailInput);
              }}
            />
          </IonItem>

          <div className="form-item seat-wrap">
            {seatGroups.map((group) => (
              <div key={group.title} style={{ width: "100%" }}>
                <p className="summary-text" style={{ margin: "10px 0 6px", fontWeight: 700 }}>
                  {group.title}
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {group.seats.map((seat: string) => {
                    const isOccupied = occupiedSeats.includes(seat);
                    const isSelected = form.seat_number.includes(seat);
                    if (isOccupied) return null;

                    return (
                      <IonButton
                        key={seat}
                        color={isSelected ? "success" : "medium"}
                        size="small"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            seat_number: prev.seat_number.includes(seat)
                              ? prev.seat_number.filter((s) => s !== seat)
                              : [...prev.seat_number, seat],
                          }))
                        }
                      >
                        {seat}
                      </IonButton>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="summary-section">
            <p className="summary-text">
              <strong>Time Started:</strong> {timeInDisplay}
            </p>
            <p className="summary-text">
              <strong>Time Out:</strong> {timeOutDisplay}
            </p>

            {!openTime && (
              <>
                <p className="summary-text">Total Hours: {totalHHMMPreview}</p>
                <p className="summary-text">Total Amount: ₱{timeAmountPreview.toFixed(2)}</p>
              </>
            )}
          </div>

          <IonButton expand="block" onClick={() => void handleSubmitBooking()}>
            Save Record
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
}
