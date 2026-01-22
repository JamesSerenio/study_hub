// Book_Add.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
  IonToggle,
  IonDatetime,
  IonModal,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonIcon,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import leaves from "../assets/leave.png";
import studyHubLogo from "../assets/study_hub.png";

const HOURLY_RATE = 20;

interface Profile {
  id: string;
  email: string;
  role: "admin" | "staff" | "user" | string;
}

interface CustomerForm {
  full_name: string;
  customer_type: "reviewer" | "student" | "regular" | "";
  customer_field: string;
  has_id: boolean;
  id_number: string;
  seat_number: string[];
  reservation: boolean;
  reservation_date?: string;
  time_started: string; // snapshot ISO
}

interface AddOn {
  id: string;
  category: string;
  name: string;
  price: number;
  restocked: number;
  sold: number;
  expenses: number;
  stocks: number;
  overall_sales: number;
  expected_sales: number;
  image_url: string | null;
}

interface SelectedAddOn {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
}

interface CustomerSessionRow {
  seat_number: string;
  time_ended: string;
  reservation: string;
  reservation_date?: string | null;
  time_started: string;
}

type SeatGroup = {
  title: string;
  seats: string[];
};

const SEAT_GROUPS: SeatGroup[] = [
  {
    title: "1stF",
    seats: ["1", "2", "3", "4", "5", "6", "7a", "7b", "8a", "8b", "9", "10", "11"],
  },
  { title: "TATAMI AREA", seats: ["12a", "12b", "12c"] },
  {
    title: "2ndF",
    seats: ["13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"],
  },
];


const Book_Add: React.FC = () => {
  // MAIN MODALS
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [isAddOnsOpen, setIsAddOnsOpen] = useState(false);

  // THANK YOU MODALS
  const [bookingThanksOpen, setBookingThanksOpen] = useState(false);
  const [addOnsThanksOpen, setAddOnsThanksOpen] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [addOns, setAddOns] = useState<AddOn[]>([]);

  // BOOKING FORM
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

  // booking time avail
  const [timeAvail, setTimeAvail] = useState<string>("01:00");
  const [timeAvailInput, setTimeAvailInput] = useState<string>("01:00");
  const [timeStartedInput, setTimeStartedInput] = useState<string>("00:00 am"); // reservation time-start
  const [timeSnapshotIso, setTimeSnapshotIso] = useState<string>(new Date().toISOString());

  // ADD-ONS FORM (SEPARATE)
  const [addOnsFullName, setAddOnsFullName] = useState<string>("");
  const [addOnsSeat, setAddOnsSeat] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showAddOns, setShowAddOns] = useState<boolean>(false);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);

  useEffect(() => {
    void fetchProfile();
    void fetchAddOns();
    void fetchOccupiedSeats();

    const interval = window.setInterval(() => void fetchOccupiedSeats(), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isBookingOpen) {
      const snap = new Date().toISOString();
      setTimeSnapshotIso(snap);
      setForm((prev) => ({ ...prev, time_started: snap }));
      setTimeStartedInput("00:00 am");
    }
  }, [isBookingOpen]);

  // ---------- TIME HELPERS ----------

  const formatTime12 = (hour24: number, minute: number): string => {
    const isPM = hour24 >= 12;
    let h12 = hour24 % 12;
    if (h12 === 0) h12 = 12;
    const hh = h12.toString().padStart(2, "0");
    const mm = minute.toString().padStart(2, "0");
    return `${hh}:${mm} ${isPM ? "pm" : "am"}`;
  };

  // "2pm" -> "02:00 pm" | "2:30pm" -> "02:30 pm" | "14:00" -> "02:00 pm" | "1400" -> "02:00 pm"
  const normalizeTimeShortcut = (raw: string): string | null => {
    const v = raw.trim().toLowerCase().replace(/\s+/g, "");

    let m = v.match(/^(\d{1,2})(am|pm)$/);
    if (m) {
      const h = parseInt(m[1], 10);
      if (h < 1 || h > 12) return null;
      const hh = h.toString().padStart(2, "0");
      return `${hh}:00 ${m[2]}`;
    }

    m = v.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
    if (m) {
      const h = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (h < 1 || h > 12) return null;
      if (mm < 0 || mm > 59) return null;
      const hh = h.toString().padStart(2, "0");
      const mmm = mm.toString().padStart(2, "0");
      return `${hh}:${mmm} ${m[3]}`;
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

    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
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

    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    if (h < 0 || h > 999) return null;
    if (m < 0 || m > 59) return null;
    if (h === 0 && m === 0) return null;

    const paddedH = h.toString().padStart(2, "0");
    const paddedM = m.toString().padStart(2, "0");
    return `${paddedH}:${paddedM}`;
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

  // ---------- FETCHES ----------

  const fetchProfile = async (): Promise<void> => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("id", auth.user.id)
      .single<Profile>();

    if (error) {
      console.error(error);
      return;
    }
    if (data) setProfile(data);
  };

  const fetchAddOns = async (): Promise<void> => {
    const { data, error } = await supabase.from("add_ons").select("*").order("category", { ascending: true });
    if (error) {
      console.error(error);
      alert("Error loading add-ons.");
      return;
    }
    setAddOns((data as AddOn[]) || []);
  };

  const fetchOccupiedSeats = async (date?: string, start?: string, end?: string): Promise<void> => {
    try {
      let query = supabase
        .from("customer_sessions")
        .select("seat_number, time_ended, reservation, reservation_date, time_started");

      if (date && start && end) {
        query = query
          .eq("reservation", "yes")
          .eq("reservation_date", date)
          .lt("time_started", end)
          .gt("time_ended", start);
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
    } catch (err) {
      console.error(err);
    }
  };

  // ---------- BOOKING OVERLAP CHECK ----------
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

  // ---------- ADD-ONS LOGIC (SEPARATE) ----------

  const categories = useMemo(() => [...new Set(addOns.map((a) => a.category))], [addOns]);

  const addOnsByCategory = (category: string) => selectedAddOns.filter((s) => s.category === category);

  const addOnsTotal = useMemo(
    () => selectedAddOns.reduce((sum, s) => sum + s.quantity * s.price, 0),
    [selectedAddOns]
  );

  const handleAddOnQuantityChange = (id: string, quantity: number): void => {
    const q = Math.max(0, Math.floor(quantity));
    setSelectedAddOns((prev) => {
      const existing = prev.find((s) => s.id === id);

      if (q > 0) {
        if (existing) return prev.map((s) => (s.id === id ? { ...s, quantity: q } : s));
        const addOn = addOns.find((a) => a.id === id);
        if (!addOn) return prev;
        return [...prev, { id, name: addOn.name, category: addOn.category, price: addOn.price, quantity: q }];
      }
      return prev.filter((s) => s.id !== id);
    });
  };

  const handleCategoryChange = (index: number, category: string): void => {
    setSelectedCategories((prev) => {
      const next = [...prev];
      const old = next[index];
      next[index] = category;

      // remove selected add-ons under old category if category changed
      if (old && old !== category) {
        setSelectedAddOns((prevAdd) => prevAdd.filter((s) => s.category !== old));
      }
      return next;
    });
  };

  const removeCategory = (index: number): void => {
    const cat = selectedCategories[index];
    setSelectedCategories((prev) => prev.filter((_, i) => i !== index));
    setSelectedAddOns((prev) => prev.filter((s) => s.category !== cat));
  };

  const openAddOnsModal = (): void => {
    setIsAddOnsOpen(true);
    if (!showAddOns) {
      setShowAddOns(true);
      setSelectedCategories([""]);
    } else if (selectedCategories.length === 0) {
      setSelectedCategories([""]);
    }
  };

  const addAnotherCategory = (): void => {
    if (!showAddOns) {
      setShowAddOns(true);
      setSelectedCategories([""]);
    } else {
      setSelectedCategories((prev) => [...prev, ""]);
    }
  };

  const resetAddOnsForm = (): void => {
    setAddOnsFullName("");
    setAddOnsSeat("");
    setSelectedAddOns([]);
    setSelectedCategories([]);
    setShowAddOns(false);
  };

  const handleSubmitAddOns = async (): Promise<void> => {
    const name = addOnsFullName.trim();
    if (!name) {
      alert("Full Name is required.");
      return;
    }
    if (!addOnsSeat) {
      alert("Seat Number is required.");
      return;
    }
    if (selectedAddOns.length === 0) {
      alert("Please select at least one add-on.");
      return;
    }

    // stock check
    for (const selected of selectedAddOns) {
      const addOn = addOns.find((a) => a.id === selected.id);
      if (!addOn || addOn.stocks < selected.quantity) {
        alert(`Insufficient stock for ${selected.name}. Available: ${addOn?.stocks ?? 0}`);
        return;
      }
    }

    // insert per item based on YOUR TABLE:
    // customer_session_add_ons(add_on_id, quantity, price, full_name, seat_number)
    for (const selected of selectedAddOns) {
      const { error } = await supabase.from("customer_session_add_ons").insert({
        add_on_id: selected.id,
        quantity: selected.quantity,
        price: selected.price,
        full_name: name,
        seat_number: addOnsSeat,
      });

      if (error) {
        alert(`Error adding ${selected.name}: ${error.message}`);
        return;
      }
    }

    // refresh stock
    void fetchAddOns();

    setIsAddOnsOpen(false);
    setAddOnsThanksOpen(true);
    resetAddOnsForm();
  };

  // ---------- BOOKING SUBMIT ----------

  const handleSubmitBooking = async (): Promise<void> => {
    const trimmedName = form.full_name.trim();
    if (!trimmedName) {
      alert("Full Name is required.");
      return;
    }

    if (!profile) {
      alert("You must be logged in to save records.");
      return;
    }

    if (form.seat_number.length === 0) {
      alert("Please select at least one seat.");
      return;
    }

    if (form.reservation && !form.reservation_date) {
      alert("Please select a reservation date.");
      return;
    }

    // reservation always requires time started input
    let startIsoToStore = new Date().toISOString();
    if (form.reservation) {
      const normalized = normalizeTimeShortcut(timeStartedInput);
      if (!normalized) {
        alert('Please enter a valid Time Started (e.g., "2pm", "2:30pm", "14:00", "1400").');
        return;
      }
      const parsed = parseTimeToISO(normalized, form.reservation_date as string);
      if (!parsed) {
        alert("Invalid Time Started.");
        return;
      }
      startIsoToStore = parsed;
    } else {
      startIsoToStore = new Date().toISOString();
    }

    // if not reservation AND not open time => require time avail
    if (!form.reservation && !openTime && getTotalHours() <= 0) {
      alert("Invalid time avail - Please enter a valid time (e.g., 01:00)");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      alert("You must be logged in to save records.");
      return;
    }

    const dateToStore =
      form.reservation && form.reservation_date
        ? form.reservation_date.split("T")[0]
        : new Date().toISOString().split("T")[0];

    const timeEndedToStore = openTime
      ? new Date("2999-12-31T23:59:59.000Z").toISOString()
      : getTimeEndedFrom(startIsoToStore);

    const totalHours = openTime ? 0 : getTotalHours();
    const timeAmount = openTime ? 0 : totalHours * HOURLY_RATE;

    const { error: sessionError } = await supabase.from("customer_sessions").insert({
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
      total_amount: timeAmount, // booking is separate (no add-ons included)
      seat_number: form.seat_number.join(", "),
      reservation: form.reservation ? "yes" : "no",
      reservation_date: form.reservation_date,
    });

    if (sessionError) {
      alert(`Error saving session: ${sessionError.message}`);
      return;
    }

    // reset booking form
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

    void fetchOccupiedSeats();

    setIsBookingOpen(false);
    setBookingThanksOpen(true);
  };

  // ---------- DISPLAY ----------

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

  return (
    <IonPage className="bookadd-page">
      <IonHeader />

      <IonContent fullscreen className="bookadd-content" scrollY={false}>
        <img src={leaves} className="leaf leaf-top-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-top-right" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-right" alt="leaf" />

        <div className="bookadd-wrapper">
          <div className="bookadd-hero-card">
            {/* HEADER */}
            <div className="bookadd-hero-header">
              <div className="bookadd-hero-brand">
                <img src={studyHubLogo} className="bookadd-hero-logo" alt="Study Hub" />
                <div className="bookadd-hero-text">
                  <p className="bookadd-hero-title">Welcome to Me Tyme Lounge!</p>
                  <p className="bookadd-hero-subtitle">Rest, relax, and focus in a peaceful environment.</p>
                </div>
              </div>

              <div className="bookadd-hero-chip">
                <span className="bookadd-hero-chip-dot" />
                <span className="bookadd-hero-chip-text">Ready for booking</span>
              </div>
            </div>

            {/* TOPBAR */}
            <div className="bookadd-topbar">
              <p className="bookadd-topbar-title">Choose Action</p>
              <p className="bookadd-topbar-subtitle">Book your seat or order add-ons separately.</p>
            </div>

            {/* ACTION BUTTONS */}
            <div className="bookadd-actions">
              {/* BOOKING */}
              <div className="bookadd-btn-card bookadd-btn-booking">
                <span className="bookadd-btn-label">Booking</span>
                <p className="bookadd-btn-desc">Choose your seat and booking time.</p>

                <IonButton
                  expand="block"
                  onClick={() => {
                    setTimeSnapshotIso(new Date().toISOString());
                    setIsBookingOpen(true);
                  }}
                >
                  Booking
                </IonButton>
              </div>

              {/* ADD-ONS */}
              <div className="bookadd-btn-card bookadd-btn-addons">
                <span className="bookadd-btn-label">Add-Ons</span>
                <p className="bookadd-btn-desc">Enter seat + name then choose add-ons.</p>

                <IonButton expand="block" onClick={openAddOnsModal}>
                  Add_Ons
                </IonButton>
              </div>
            </div>
          </div>
        </div>

        {/* BOOKING MODAL */}
        <IonModal isOpen={isBookingOpen} onDidDismiss={() => setIsBookingOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Booking</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setIsBookingOpen(false)}>
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
                  onIonChange={(e) =>
                    setForm({
                      ...form,
                      customer_type: (e.detail.value as CustomerForm["customer_type"]) ?? "",
                    })
                  }
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
                      placeholder='e.g., "2pm" / "2:30pm" / "14:00"'
                      onIonChange={(e) => setTimeStartedInput(e.detail.value ?? "")}
                      onIonBlur={() => {
                        const normalized = normalizeTimeShortcut(timeStartedInput);
                        if (normalized) setTimeStartedInput(normalized);
                        else setTimeStartedInput("00:00 am");
                      }}
                    />
                  </IonItem>
                </>
              )}

              <IonItem className="form-item">
                <IonLabel position="stacked">Time Avail (HH:MM)</IonLabel>
                <IonInput
                  type="text"
                  inputmode="numeric"
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

              {/* Seats */}
              <div className="form-item seat-wrap">
                {SEAT_GROUPS.map((group) => (
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

              {/* Summary */}
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

        {/* ADD-ONS MODAL (SEPARATE: Full Name + Seat Number + Add-Ons + Submit) */}
        <IonModal isOpen={isAddOnsOpen} onDidDismiss={() => setIsAddOnsOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Add-Ons</IonTitle>
              <IonButtons slot="end">
                <IonButton
                  onClick={() => {
                    setIsAddOnsOpen(false);
                  }}
                >
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <div className="bookadd-card">
              {/* Required fields for YOUR table */}
              <IonItem className="form-item">
                <IonLabel position="stacked">Full Name *</IonLabel>
                <IonInput
                  value={addOnsFullName}
                  placeholder="Enter full name"
                  onIonChange={(e) => setAddOnsFullName(e.detail.value ?? "")}
                />
              </IonItem>

              <IonItem className="form-item">
                <IonLabel position="stacked">Seat Number *</IonLabel>
                <IonSelect value={addOnsSeat} placeholder="Choose seat" onIonChange={(e) => setAddOnsSeat(e.detail.value)}>
                  {SEAT_GROUPS.map((g) => (
                    <React.Fragment key={g.title}>
                      <IonSelectOption disabled value={`__${g.title}__`}>
                        {g.title}
                      </IonSelectOption>
                      {g.seats.map((s) => (
                        <IonSelectOption key={`${g.title}-${s}`} value={s}>
                          {s}
                        </IonSelectOption>
                      ))}
                    </React.Fragment>
                  ))}
                </IonSelect>
              </IonItem>

              <IonButton expand="block" onClick={addAnotherCategory}>
                {showAddOns ? "Add More Add-Ons" : "Add-Ons"}
              </IonButton>

              {showAddOns &&
                selectedCategories.map((category, index) => {
                  const categoryItems = addOns.filter((a) => a.category === category);

                  // prevent duplicate category in other blocks
                  const usedByOthers = new Set(selectedCategories.filter((_, i) => i !== index).filter(Boolean));
                  const availableCategories = categories.filter((c) => !usedByOthers.has(c));

                  return (
                    <div key={index} className="addon-block">
                      <div className="addon-row">
                        <IonItem className="form-item addon-flex">
                          <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                          <IonSelect
                            value={category}
                            placeholder="Choose a category"
                            onIonChange={(e) => handleCategoryChange(index, (e.detail.value as string) ?? "")}
                          >
                            {availableCategories.map((cat) => (
                              <IonSelectOption key={cat} value={cat}>
                                {cat}
                              </IonSelectOption>
                            ))}
                          </IonSelect>
                        </IonItem>

                        <IonButton color="danger" onClick={() => removeCategory(index)}>
                          x
                        </IonButton>
                      </div>

                      {category && (
                        <>
                          <IonItem className="form-item">
                            <IonLabel position="stacked">Select {category} Item</IonLabel>
                            <IonSelect
                              placeholder="Choose an item"
                              onIonChange={(e) => {
                                const selectedId = e.detail.value as string | undefined;
                                if (!selectedId) return;

                                const addOn = addOns.find((a) => a.id === selectedId);
                                if (!addOn) return;

                                setSelectedAddOns((prev) => {
                                  const existing = prev.find((s) => s.id === selectedId);
                                  if (existing) return prev;
                                  return [
                                    ...prev,
                                    {
                                      id: selectedId,
                                      name: addOn.name,
                                      category: addOn.category,
                                      price: addOn.price,
                                      quantity: 1,
                                    },
                                  ];
                                });
                              }}
                            >
                              {categoryItems.map((a) => (
                                <IonSelectOption key={a.id} value={a.id}>
                                  {a.name} - ₱{a.price} (Stock: {a.stocks})
                                </IonSelectOption>
                              ))}
                            </IonSelect>
                          </IonItem>

                          {addOnsByCategory(category).length > 0 && (
                            <IonList>
                              <IonListHeader>
                                <IonLabel>Selected {category} Items</IonLabel>
                              </IonListHeader>

                              {addOnsByCategory(category).map((selected) => (
                                <IonItem key={selected.id} className="addon-item">
                                  <IonLabel>
                                    <div style={{ fontWeight: 700 }}>{selected.name}</div>
                                    <div style={{ opacity: 0.8 }}>₱{selected.price}</div>
                                    <div style={{ marginTop: 4, fontWeight: 700 }}>
                                      Subtotal: ₱{(selected.price * selected.quantity).toFixed(2)}
                                    </div>
                                  </IonLabel>

                                  <div className="addon-actions">
                                    <IonLabel className="qty-label">Qty:</IonLabel>
                                    <IonInput
                                      type="number"
                                      min={1}
                                      value={selected.quantity}
                                      className="qty-input"
                                      onIonChange={(e) => {
                                        const v = parseInt((e.detail.value ?? "0").toString(), 10);
                                        handleAddOnQuantityChange(selected.id, Number.isNaN(v) ? 0 : v);
                                      }}
                                    />
                                    <IonButton
                                      color="danger"
                                      onClick={() => setSelectedAddOns((prev) => prev.filter((s) => s.id !== selected.id))}
                                    >
                                      Remove
                                    </IonButton>
                                  </div>
                                </IonItem>
                              ))}
                            </IonList>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

              {/* TOTAL + SUBMIT */}
              <div className="summary-section" style={{ marginTop: 12 }}>
                <p className="summary-text">
                  <strong>Add-Ons Total: ₱{addOnsTotal.toFixed(2)}</strong>
                </p>
              </div>

              <IonButton expand="block" onClick={() => void handleSubmitAddOns()}>
                Submit Order
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        {/* THANK YOU MODAL: BOOKING */}
        <IonModal isOpen={bookingThanksOpen} onDidDismiss={() => setBookingThanksOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Thank you!</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setBookingThanksOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="bookadd-card">
              <p className="summary-text" style={{ fontWeight: 800, marginBottom: 8 }}>
                Thanks for booking.
              </p>
              <p className="summary-text" style={{ opacity: 0.85 }}>
                Please wait a moment. Staff will review your booking details.
              </p>
              <IonButton expand="block" onClick={() => setBookingThanksOpen(false)}>
                OK
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        {/* THANK YOU MODAL: ADD-ONS */}
        <IonModal isOpen={addOnsThanksOpen} onDidDismiss={() => setAddOnsThanksOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Thank you!</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setAddOnsThanksOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <div className="bookadd-card">
              <p className="summary-text" style={{ fontWeight: 800, marginBottom: 8 }}>
                Thank you for your order.
              </p>
              <p className="summary-text" style={{ opacity: 0.85 }}>
                Please wait a few minutes. Staff will confirm and deliver your add-ons.
              </p>
              <IonButton expand="block" onClick={() => setAddOnsThanksOpen(false)}>
                OK
              </IonButton>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Book_Add;
