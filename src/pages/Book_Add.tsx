// Book_Add.tsx
import React, { useEffect, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonContent,
  IonButton,
  IonGrid,
  IonRow,
  IonCol,
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
  time_started: string; // ISO
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

const Book_Add: React.FC = () => {
  const [isBookingOpen, setIsBookingOpen] = useState<boolean>(false);
  const [isAddOnsOpen, setIsAddOnsOpen] = useState<boolean>(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showAddOns, setShowAddOns] = useState<boolean>(false);

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

  // ✅ validated time (used in computations)
  const [timeAvail, setTimeAvail] = useState<string>("01:00");
  // ✅ raw input (so user can type freely without “bug”)
  const [timeAvailInput, setTimeAvailInput] = useState<string>("01:00");

  const [timeStartedInput, setTimeStartedInput] = useState<string>("09:00 am");
  const [occupiedSeats, setOccupiedSeats] = useState<string[]>([]);

  // ✅ "Open Time" mode (no time out)
  const [openTime, setOpenTime] = useState<boolean>(false);

  const allSeats: string[] = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7a",
    "7b",
    "8a",
    "8b",
    "9",
    "10",
    "11",
    "12a",
    "12b",
    "12c",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
  ];

  useEffect(() => {
    void fetchProfile();
    void fetchAddOns();
    void fetchOccupiedSeats();

    const interval = window.setInterval(() => void fetchOccupiedSeats(), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (form.reservation && form.reservation_date) {
      void fetchOccupiedSeats(form.reservation_date, form.time_started, getTimeEnded());
    } else {
      void fetchOccupiedSeats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.reservation, form.reservation_date, form.time_started, timeAvail, openTime]);

  const parseTimeToISO = (timeInput: string, date: string): string => {
    const match = timeInput.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!match) return new Date(date).toISOString();

    const h = match[1];
    const m = match[2];
    const period = match[3];

    let hour = parseInt(h, 10);
    const minute = parseInt(m, 10);

    if (period.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (period.toLowerCase() === "am" && hour === 12) hour = 0;

    const d = new Date(date);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  useEffect(() => {
    if (form.reservation && form.reservation_date) {
      const iso = parseTimeToISO(timeStartedInput, form.reservation_date);
      setForm((prev) => ({ ...prev, time_started: iso }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeStartedInput, form.reservation_date, form.reservation]);

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
        query = query.eq("reservation", "yes").eq("reservation_date", date).lt("time_started", end).gt("time_ended", start);
      } else {
        const nowIso = new Date().toISOString();
        query = query.lte("time_started", nowIso).gt("time_ended", nowIso);
      }

      const { data } = await query;

      if (data) {
        const seats = (data as CustomerSessionRow[]).flatMap((s) => s.seat_number.split(",").map((seat) => seat.trim()));
        setOccupiedSeats(seats);
      }
    } catch (err) {
      console.error(err);
    }
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
    if (!timeAvail.includes(":")) return 0;
    const [h, m] = timeAvail.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || m < 0 || m > 59) return 0;
    return Number((h + m / 60).toFixed(2));
  };

  const getTimeEnded = (): string => {
    // ✅ Open Time: no time out (return start so UI won't crash; we will display "OPEN")
    if (openTime) return form.time_started;

    const start = new Date(form.time_started);
    const [h, m] = timeAvail.split(":").map(Number);
    start.setHours(start.getHours() + h);
    start.setMinutes(start.getMinutes() + m);
    return start.toISOString();
  };

  const totalHours = getTotalHours();
  const timeAmount = openTime ? 0 : totalHours * HOURLY_RATE;
  const addOnsAmount = selectedAddOns.reduce((sum, s) => sum + s.quantity * s.price, 0);
  const totalAmount = timeAmount + addOnsAmount;

  const categories = [...new Set(addOns.map((a) => a.category))];

  const handleAddOnQuantityChange = (id: string, quantity: number): void => {
    setSelectedAddOns((prev) => {
      const existing = prev.find((s) => s.id === id);

      if (quantity > 0) {
        if (existing) return prev.map((s) => (s.id === id ? { ...s, quantity } : s));
        const addOn = addOns.find((a) => a.id === id);
        if (!addOn) return prev;
        return [...prev, { id, name: addOn.name, category: addOn.category, price: addOn.price, quantity }];
      }
      return prev.filter((s) => s.id !== id);
    });
  };

  const handleCategoryChange = (index: number, category: string): void => {
    setSelectedCategories((prev) => {
      const next = [...prev];
      next[index] = category;
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

  // ✅ button: set time_started = present time
  const setTimeInNow = (): void => {
    const iso = new Date().toISOString();
    setForm((prev) => ({ ...prev, time_started: iso }));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!profile) {
      alert("You must be logged in to save records.");
      return;
    }
    if (!openTime && totalHours <= 0) {
      alert("Invalid time avail - Please enter a valid time (e.g., 01:00)");
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

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      alert("You must be logged in to save records.");
      return;
    }

    for (const selected of selectedAddOns) {
      const addOn = addOns.find((a) => a.id === selected.id);
      if (!addOn || addOn.stocks < selected.quantity) {
        alert(`Insufficient stock for ${selected.name}. Available: ${addOn?.stocks ?? 0}`);
        return;
      }
    }

    const dateToStore =
      form.reservation && form.reservation_date ? form.reservation_date.split("T")[0] : new Date().toISOString().split("T")[0];

    // ✅ Open Time -> store a far future time_ended so seats stay occupied
    const timeEndedToStore = openTime ? new Date("2999-12-31T23:59:59.000Z").toISOString() : getTimeEnded();

    const { data: sessionData, error: sessionError } = await supabase
      .from("customer_sessions")
      .insert({
        staff_id: auth.user.id,
        date: dateToStore,
        full_name: form.full_name,
        customer_type: form.customer_type,
        customer_field: form.customer_field,
        has_id: form.has_id,
        id_number: form.id_number,
        hour_avail: openTime ? "OPEN" : timeAvail,
        time_started: form.time_started,
        time_ended: timeEndedToStore,
        total_hours: openTime ? 0 : totalHours,
        total_amount: totalAmount,
        seat_number: form.seat_number.join(", "),
        reservation: form.reservation ? "yes" : "no",
        reservation_date: form.reservation_date,
      })
      .select("id")
      .single();

    if (sessionError || !sessionData) {
      alert(`Error saving session: ${sessionError?.message ?? "Unknown error"}`);
      return;
    }

    const sessionId: string = sessionData.id as string;

    for (const selected of selectedAddOns) {
      const { error: addOnError } = await supabase.from("customer_session_add_ons").insert({
        session_id: sessionId,
        add_on_id: selected.id,
        quantity: selected.quantity,
        price: selected.price,
      });

      if (addOnError) {
        alert(`Error adding ${selected.name}: ${addOnError.message}`);
        return;
      }
    }

    alert("Customer session saved!");

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
    setTimeStartedInput("09:00 am");
    setSelectedAddOns([]);
    setSelectedCategories([]);
    setShowAddOns(false);
    setOpenTime(false);

    void fetchAddOns();
    void fetchOccupiedSeats();

    setIsBookingOpen(false);
    setIsAddOnsOpen(false);
  };

  const formatPH = (d: Date) =>
    d.toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const timeInDisplay = formatPH(new Date(form.time_started));
  const timeOutDisplay = openTime ? "OPEN TIME" : formatPH(new Date(getTimeEnded()));

  const addOnsByCategory = (category: string) => selectedAddOns.filter((s) => s.category === category);

  return (
    <IonPage className="bookadd-page">
      <IonHeader />

      <IonContent fullscreen className="bookadd-content" scrollY={false}>
        {/* Background leaves */}
        <img src={leaves} className="leaf leaf-top-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-top-right" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-left" alt="leaf" />
        <img src={leaves} className="leaf leaf-bottom-right" alt="leaf" />

        <div className="bookadd-wrapper">
          <IonGrid className="bookadd-top-buttons">
            <IonRow>
              <IonCol size="6">
                <IonButton expand="block" onClick={openAddOnsModal}>
                  Add_Ons
                </IonButton>
              </IonCol>
              <IonCol size="6">
                <IonButton expand="block" onClick={() => setIsBookingOpen(true)}>
                  Booking
                </IonButton>
              </IonCol>
            </IonRow>
          </IonGrid>
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
              {/* ✅ OPEN TIME toggle + set time-in now */}
              <IonItem className="form-item">
                <IonLabel>Open Time</IonLabel>
                <IonToggle checked={openTime} onIonChange={(e) => setOpenTime(e.detail.checked)} />
                <IonLabel slot="end">{openTime ? "Yes" : "No"}</IonLabel>
              </IonItem>

              <IonButton expand="block" fill="outline" onClick={setTimeInNow}>
                Set Time In (Now)
              </IonButton>

              <IonItem className="form-item">
                <IonLabel position="stacked">Full Name</IonLabel>
                <IonInput value={form.full_name} onIonChange={(e) => setForm({ ...form, full_name: e.detail.value ?? "" })} />
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
                    <IonLabel position="stacked">Time Started</IonLabel>
                    <IonInput
                      value={timeStartedInput}
                      placeholder="e.g., 09:00 am"
                      onIonChange={(e) => setTimeStartedInput(e.detail.value ?? "")}
                    />
                  </IonItem>
                </>
              )}

              {/* ✅ Time Avail: editable without bug */}
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
                      setTimeAvailInput(timeAvail); // revert to last valid
                    }
                  }}
                />
              </IonItem>

              <div className="form-item seat-wrap">
                {allSeats.map((seat) => {
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

              {/* ✅ bottom summary: no Present Time */}
             <div className="summary-section">
                <p className="summary-text">
                    <strong>Time In:</strong> {timeInDisplay}
                </p>

                <p className="summary-text">
                    <strong>Time Out:</strong> {timeOutDisplay}
                </p>

                {!openTime && (
                    <>
                    <p className="summary-text">Total Hours: {totalHours}</p>
                    <p className="summary-text">Time Amount: ₱{timeAmount.toFixed(2)}</p>
                    </>
                )}

                <p className="summary-text">
                    <strong>Overall Total: ₱{totalAmount.toFixed(2)}</strong>
                </p>
                </div>

              <IonButton expand="block" onClick={() => void handleSubmit()}>
                Save Record
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        {/* ADD-ONS MODAL */}
        <IonModal isOpen={isAddOnsOpen} onDidDismiss={() => setIsAddOnsOpen(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Add-Ons</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setIsAddOnsOpen(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <div className="bookadd-card">
              <IonButton expand="block" onClick={addAnotherCategory}>
                {showAddOns ? "Add More Add-Ons" : "Add-Ons"}
              </IonButton>

              {showAddOns &&
                selectedCategories.map((category, index) => {
                  const categoryItems = addOns.filter((a) => a.category === category);

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
                            {categories.map((cat) => (
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
                              {categoryItems.map((addOn) => (
                                <IonSelectOption key={addOn.id} value={addOn.id}>
                                  {addOn.name} - ₱{addOn.price}
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
                                    {selected.name} - ₱{selected.price}
                                  </IonLabel>

                                  <div className="addon-actions">
                                    <IonLabel className="qty-label">Qty:</IonLabel>
                                    <IonInput
                                      type="number"
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
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Book_Add;
