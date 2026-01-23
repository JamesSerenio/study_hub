// ✅ Fix: remove all "any" usage (especially in IonSelect onIonChange)
// src/components/BookingModal.tsx

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

const HOURLY_RATE = 20;

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

interface CustomerSessionRow {
  seat_number: string;
  time_ended: string;
  reservation: string;
  reservation_date?: string | null;
  time_started: string;
}

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void; // open thank-you modal in parent
  seatGroups: SeatGroup[];
};

const isCustomerType = (v: unknown): v is CustomerType =>
  v === "" || v === "reviewer" || v === "student" || v === "regular";

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
  const [timeAvail, setTimeAvail] = useState("01:00");
  const [timeAvailInput, setTimeAvailInput] = useState("01:00");
  const [timeStartedInput, setTimeStartedInput] = useState("00:00 am");
  const [timeSnapshotIso, setTimeSnapshotIso] = useState(new Date().toISOString());

  useEffect(() => {
    if (!isOpen) return;
    const snap = new Date().toISOString();
    setTimeSnapshotIso(snap);
    setForm((p) => ({ ...p, time_started: snap }));
    setTimeStartedInput("00:00 am");
    void fetchOccupiedSeats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    const v = value.trim();
    const match = v.match(/^(\d{1,3}):(\d{1,2})$/);
    if (!match) return null;

    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h < 0 || h > 999) return null;
    if (m < 0 || m > 59) return null;
    if (h === 0 && m === 0) return null;

    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  };

  const getTotalHours = (): number => {
    const [h, m] = timeAvail.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0 || m > 59) return 0;
    return Number((h + m / 60).toFixed(2));
  };

  const getTimeEndedFrom = (startIso: string): string => {
    if (openTime) return startIso;
    const start = new Date(startIso);
    const [h, m] = timeAvail.split(":").map(Number);
    start.setHours(start.getHours() + h);
    start.setMinutes(start.getMinutes() + m);
    return start.toISOString();
  };

  const fetchOccupiedSeats = async (date?: string, start?: string, end?: string): Promise<void> => {
    let query = supabase
      .from("customer_sessions")
      .select("seat_number, time_ended, reservation, reservation_date, time_started");

    if (date && start && end) {
      query = query.eq("reservation", "yes").eq("reservation_date", date).lt("time_started", end).gt("time_ended", start);
    } else {
      const nowIso = new Date().toISOString();
      query = query.lte("time_started", nowIso).gt("time_ended", nowIso);
    }

    const { data } = await query;
    if (data) {
      const seats = (data as CustomerSessionRow[]).flatMap((s) =>
        s.seat_number.split(",").map((seat) => seat.trim())
      );
      setOccupiedSeats(seats);
    }
  };

  useEffect(() => {
    if (form.reservation && form.reservation_date) {
      const normalized = normalizeTimeShortcut(timeStartedInput) ?? timeStartedInput;
      const parsed = parseTimeToISO(normalized, form.reservation_date);
      const startIso = parsed ?? form.time_started;
      const endIso = openTime ? startIso : getTimeEndedFrom(startIso);
      void fetchOccupiedSeats(form.reservation_date, startIso, endIso);
    } else {
      void fetchOccupiedSeats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.reservation, form.reservation_date, openTime, timeStartedInput, timeAvail]);

  const formatPH = (d: Date) =>
    d.toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const summaryStartIso = useMemo(() => {
    if (form.reservation && form.reservation_date) {
      const normalized = normalizeTimeShortcut(timeStartedInput) ?? "00:00 am";
      const parsed = parseTimeToISO(normalized, form.reservation_date);
      return parsed ?? timeSnapshotIso;
    }
    return timeSnapshotIso;
  }, [form.reservation, form.reservation_date, timeStartedInput, timeSnapshotIso]);

  const summaryEndIso = useMemo(() => {
    if (openTime) return summaryStartIso;
    return getTimeEndedFrom(summaryStartIso);
  }, [openTime, summaryStartIso, timeAvail]);

  const totalHoursPreview = getTotalHours();
  const timeAmountPreview = openTime ? 0 : totalHoursPreview * HOURLY_RATE;
  const timeInDisplay = formatPH(new Date(summaryStartIso));
  const timeOutDisplay = openTime ? "OPEN TIME" : formatPH(new Date(summaryEndIso));

  const handleSubmitBooking = async (): Promise<void> => {
    const trimmedName = form.full_name.trim();
    if (!trimmedName) return alert("Full Name is required.");
    if (form.seat_number.length === 0) return alert("Please select at least one seat.");
    if (form.reservation && !form.reservation_date) return alert("Please select a reservation date.");

    let startIsoToStore = new Date().toISOString();
    if (form.reservation) {
      const normalized = normalizeTimeShortcut(timeStartedInput);
      if (!normalized) return alert('Please enter a valid Time Started (e.g., "2pm", "2:30pm", "14:00", "1400").');
      const parsed = parseTimeToISO(normalized, form.reservation_date as string);
      if (!parsed) return alert("Invalid Time Started.");
      startIsoToStore = parsed;
    }

    if (!form.reservation && !openTime && getTotalHours() <= 0) {
      return alert("Invalid time avail - Please enter a valid time (e.g., 01:00)");
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

    const totalHours = openTime ? 0 : getTotalHours();
    const timeAmount = openTime ? 0 : totalHours * HOURLY_RATE;

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
      total_time: totalHours,
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
    setTimeAvail("01:00");
    setTimeAvailInput("01:00");
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
            <IonToggle checked={form.has_id} onIonChange={(e) => setForm({ ...form, has_id: e.detail.checked })} />
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
            <IonToggle checked={form.reservation} onIonChange={(e) => setForm({ ...form, reservation: e.detail.checked })} />
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
                  placeholder='e.g., "2pm" / "2:30pm" / "14:00"'
                  onIonChange={(e) => setTimeStartedInput(e.detail.value ?? "")}
                  onIonBlur={() => {
                    const normalized = normalizeTimeShortcut(timeStartedInput);
                    setTimeStartedInput(normalized ?? "00:00 am");
                  }}
                />
              </IonItem>
            </>
          )}

          <IonItem className="form-item">
            <IonLabel position="stacked">Time Avail (HH:MM)</IonLabel>
            <IonInput
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              value={timeAvailInput}
              disabled={openTime}
              onIonChange={(e) => setTimeAvailInput(e.detail.value ?? "")}
              onIonBlur={() => {
                const normalized = normalizeTimeAvail(timeAvailInput);
                if (normalized) {
                  setTimeAvail(normalized);
                  setTimeAvailInput(normalized);
                } else {
                  setTimeAvailInput(timeAvail);
                }
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
                  {group.seats.map((seat) => {
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
                <p className="summary-text">Total Hours: {totalHoursPreview}</p>
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
