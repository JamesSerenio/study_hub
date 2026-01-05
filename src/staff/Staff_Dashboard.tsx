import React, { useEffect, useState } from "react";
import { IonButton, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption, IonList, IonListHeader, IonToggle, IonDatetime } from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

const HOURLY_RATE = 20;

interface Profile {
  id: string;
  email: string;
  role: "admin" | "staff";
}

interface CustomerForm {
  full_name: string;
  customer_type: "reviewer" | "student" | "regular" | "";
  customer_field: string;
  has_id: boolean;
  id_number: string;
  seat_number: string[];  // Changed to array for multiple selection
  reservation: boolean;
  reservation_date?: string;
  time_started: string;  // Make editable for reservation
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
  image_url: string;
}

interface SelectedAddOn {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
}

interface CustomerSession {
  seat_number: string;
  time_ended: string;
}

const Staff_Dashboard: React.FC = () => {
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
    seat_number: [],  // Initialize as empty array
    reservation: false,
    reservation_date: undefined,
    time_started: new Date().toISOString(),  // Default to current time
  });

  const [timeAvail, setTimeAvail] = useState<string>("01:00");
  const [timeStartedInput, setTimeStartedInput] = useState<string>("09:00 am"); // New state for time input in 12-hour format
  const [occupiedSeats, setOccupiedSeats] = useState<string[]>([]);

  const allSeats = [
    "1","2","3","4","5","6","7a","7b","8a","8b","9","10","11",
    "12a","12b","12c","13","14","15","16","17","18","19","20","21","22","23","24","25"
  ];

  useEffect(() => {
    fetchProfile();
    fetchAddOns();
    fetchOccupiedSeats();
    const interval = setInterval(fetchOccupiedSeats, 60000); // refresh every 1 min
    return () => clearInterval(interval);
  }, []);

  // Function to parse 12-hour time input to 24-hour ISO string
  const parseTimeToISO = (timeInput: string): string => {
    const match = timeInput.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!match) return new Date().toISOString(); // Fallback to current time if invalid
    const [, hours, minutes, period] = match; // Destructure, skipping the full match
    let h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    if (period.toLowerCase() === 'pm' && h !== 12) h += 12;
    if (period.toLowerCase() === 'am' && h === 12) h = 0;
    const now = new Date();
    now.setHours(h, m, 0, 0);
    return now.toISOString();
  };

  // Update form.time_started whenever timeStartedInput changes
  useEffect(() => {
    if (form.reservation) {
      setForm(prev => ({ ...prev, time_started: parseTimeToISO(timeStartedInput) }));
    }
  }, [timeStartedInput, form.reservation]);

  const fetchProfile = async (): Promise<void> => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, email, role")
      .eq("id", auth.user.id)
      .single<Profile>();
    if (!data || data.role !== "staff") {
      alert("Staff only");
      return;
    }
    setProfile(data);
  };

  const fetchAddOns = async (): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("category", { ascending: true });
      if (error) throw error;
      setAddOns(data || []);
    } catch (error) {
      console.error("Error fetching add-ons:", error);
      alert("Error loading add-ons.");
    }
  };

  const fetchOccupiedSeats = async () => {
    try {
      const now = new Date().toISOString();
      const { data } = await supabase
        .from("customer_sessions")
        .select("seat_number, time_ended")
        .gt("time_ended", now); // only sessions that haven't ended

      if (data) {
        // Split seat_number by comma and trim, then flatten the array
        const seats = (data as CustomerSession[]).flatMap(s => s.seat_number.split(', ').map(seat => seat.trim()));
        setOccupiedSeats(seats);
      }
    } catch (err) {
      console.error("Error fetching occupied seats:", err);
    }
  };

  const getTotalHours = (): number => {
    if (!timeAvail || !timeAvail.includes(":")) return 0;
    const [h, m] = timeAvail.split(":").map(Number);
    if (isNaN(h) || isNaN(m) || h < 0 || m < 0 || m > 59) return 0;
    return Number((h + m / 60).toFixed(2));
  };

  const getTimeEnded = (): string => {
    const start = new Date(form.time_started);
    const [h, m] = timeAvail.split(":").map(Number);
    start.setHours(start.getHours() + h);
    start.setMinutes(start.getMinutes() + m);
    return start.toISOString();
  };

  const totalHours = getTotalHours();
  const timeAmount = totalHours * HOURLY_RATE;
  const addOnsAmount = selectedAddOns.reduce((sum, s) => sum + (s.quantity * s.price), 0);
  const totalAmount = timeAmount + addOnsAmount;
  const categories = [...new Set(addOns.map(a => a.category))];

  const handleAddOnQuantityChange = (id: string, quantity: number) => {
    setSelectedAddOns(prev => {
      const existing = prev.find(s => s.id === id);
      if (quantity > 0) {
        if (existing) {
          return prev.map(s => s.id === id ? { ...s, quantity } : s);
        } else {
          const addOn = addOns.find(a => a.id === id);
          if (addOn) {
            return [...prev, { id, name: addOn.name, category: addOn.category, price: addOn.price, quantity }];
          }
        }
      } else {
        return prev.filter(s => s.id !== id);
      }
      return prev;
    });
  };

  const handleCategoryChange = (index: number, category: string) => {
    setSelectedCategories(prev => {
      const newCategories = [...prev];
      newCategories[index] = category;
      return newCategories;
    });
  };

  const removeCategory = (index: number) => {
    const categoryToRemove = selectedCategories[index];
    setSelectedCategories(prev => prev.filter((_, i) => i !== index));
    setSelectedAddOns(prev => prev.filter(s => s.category !== categoryToRemove));
  };

  const handleAddOnsClick = () => {
    if (!showAddOns) {
      setShowAddOns(true);
      setSelectedCategories([""]);
    } else {
      setSelectedCategories(prev => [...prev, ""]);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (!profile) {
      alert("You must be logged in as staff to save records.");
      return;
    }
    if (totalHours <= 0) {
      alert("Invalid time avail - Please enter a valid time (e.g., 01:00)");
      return;
    }
    if (form.seat_number.length === 0) {  // Changed to check array length
      alert("Please select at least one seat.");
      return;
    }
    if (form.reservation && !form.reservation_date) {
      alert("Please select a reservation date.");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    for (const selected of selectedAddOns) {
      const addOn = addOns.find(a => a.id === selected.id);
      if (!addOn || addOn.stocks < selected.quantity) {
        alert(`Insufficient stock for ${selected.name}. Available: ${addOn?.stocks || 0}`);
        return;
      }
    }

    const { data: sessionData, error: sessionError } = await supabase
      .from("customer_sessions")
      .insert({
        staff_id: auth.user.id,
        date: form.reservation ? form.reservation_date!.split('T')[0] : new Date().toISOString().split("T")[0],
        full_name: form.full_name,
        customer_type: form.customer_type,
        customer_field: form.customer_field,
        has_id: form.has_id,
        id_number: form.id_number,
        hour_avail: timeAvail,
        time_started: form.time_started,
        time_ended: getTimeEnded(),
        total_hours: totalHours,
        total_amount: totalAmount,
        seat_number: form.seat_number.join(', '),  // Store as comma-separated string
        reservation: form.reservation ? 'yes' : 'no',
        reservation_date: form.reservation_date,
      })
      .select("id")
      .single();

    if (sessionError) {
      alert(`Error saving session: ${sessionError.message}`);
      return;
    }

    const sessionId = sessionData.id;

    for (const selected of selectedAddOns) {
      const { error: addOnError } = await supabase
        .from("customer_session_add_ons")
        .insert({
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
      seat_number: [],  // Reset to empty array
      reservation: false,
      reservation_date: undefined,
      time_started: new Date().toISOString(),
    });
    setTimeAvail("01:00");
    setTimeStartedInput("09:00 am"); // Reset time input
    setSelectedAddOns([]);
    setSelectedCategories([]);
    setShowAddOns(false);
    fetchAddOns();
    fetchOccupiedSeats();
  };

  return (
    <div className="staff-dashboard">
      <h2 className="form-title">Customer Time Form</h2>
      <div className="form-container">
        {/* Full Name */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Full Name</IonLabel>
          <IonInput value={form.full_name} onIonChange={(e) => setForm({ ...form, full_name: e.detail.value ?? "" })} />
        </IonItem>

        {/* Customer Type */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Type</IonLabel>
          <IonSelect value={form.customer_type} onIonChange={(e) => setForm({ ...form, customer_type: e.detail.value })}>
            <IonSelectOption value="reviewer">Reviewer</IonSelectOption>
            <IonSelectOption value="student">Student</IonSelectOption>
            <IonSelectOption value="regular">Regular</IonSelectOption>
          </IonSelect>
        </IonItem>

        {/* Customer Field */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Field</IonLabel>
          <IonInput value={form.customer_field} onIonChange={(e) => setForm({ ...form, customer_field: e.detail.value ?? "" })} />
        </IonItem>

        {/* ID Toggle */}
        <IonItem className="form-item">
          <IonLabel>ID</IonLabel>
          <IonToggle checked={form.has_id} onIonChange={(e) => setForm({ ...form, has_id: e.detail.checked })} />
          <IonLabel slot="end">{form.has_id ? 'With' : 'Without'}</IonLabel>
        </IonItem>

        {form.has_id && (
          <IonItem className="form-item">
            <IonLabel position="stacked">Specific ID</IonLabel>
            <IonInput value={form.id_number} placeholder="e.g., National ID, Student ID" onIonChange={(e) => setForm({ ...form, id_number: e.detail.value ?? "" })} />
          </IonItem>
        )}

        {/* Reservation Toggle */}
        <IonItem className="form-item">
          <IonLabel>Reservation</IonLabel>
          <IonToggle checked={form.reservation} onIonChange={(e) => setForm({ ...form, reservation: e.detail.checked })} />
          <IonLabel slot="end">{form.reservation ? 'Yes' : 'No'}</IonLabel>
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
                    const value = e.detail.value;
                    if (typeof value === "string") {
                      setForm({ ...form, reservation_date: value });
                    }
                  }}
                />
              </IonItem>

              {/* 👇 HINDI TINANGGAL – EDITABLE TIME STARTED */}
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

        {/* Time Avail */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Time Avail (HH:MM)</IonLabel>
          <IonInput
            type="text"
            placeholder="HH:MM"
            value={timeAvail}
            onIonChange={(e) => {
              const value = e.detail.value ?? "";
              const match = value.match(/^(\d{1,2}):(\d{1,2})$/);
              if (match) {
                const h = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && (h > 0 || m > 0)) {
                  const paddedH = h.toString().padStart(2, '0');
                  const paddedM = m.toString().padStart(2, '0');
                  setTimeAvail(`${paddedH}:${paddedM}`);
                }
              } else if (value === "") {
                setTimeAvail("01:00");
              }
            }}
          />
        </IonItem>

        {/* Seat Selection */}
        <div className="form-item" style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
          {allSeats.map(seat => {
            const isOccupied = occupiedSeats.includes(seat);
            const isSelected = form.seat_number.includes(seat);  // Changed to check if in array
            if (isOccupied) return null;
            return (
              <IonButton
                key={seat}
                color={isSelected ? "success" : "medium"}
                size="small"
                onClick={() => setForm(prev => ({
                  ...prev,
                  seat_number: prev.seat_number.includes(seat)
                    ? prev.seat_number.filter(s => s !== seat)  // Remove if already selected
                    : [...prev.seat_number, seat]  // Add if not selected
                }))}
              >
                {seat}
              </IonButton>
            );
          })}
        </div>

        {/* Add-Ons */}
        <IonButton expand="block" onClick={handleAddOnsClick}>
          {showAddOns ? "Add More Add-Ons" : "Add-Ons"}
        </IonButton>

        {showAddOns && selectedCategories.map((category, index) => {
          const categoryItems = addOns.filter(a => a.category === category);
          return (
            <div key={index}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <IonItem className="form-item" style={{ flex: 1 }}>
                  <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                  <IonSelect value={category} placeholder="Choose a category" onIonChange={(e) => handleCategoryChange(index, e.detail.value)}>
                    {categories.map(cat => (
                      <IonSelectOption key={cat} value={cat}>{cat}</IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
                <IonButton color="danger" onClick={() => removeCategory(index)}>x</IonButton>
              </div>
              {category && (
                <>
                  <IonItem className="form-item">
                    <IonLabel position="stacked">Select {category} Item</IonLabel>
                    <IonSelect placeholder="Choose an item" onIonChange={(e) => {
                      const selectedId = e.detail.value;
                      if (selectedId) {
                        const addOn = addOns.find(a => a.id === selectedId);
                        if (addOn) {
                          setSelectedAddOns(prev => {
                            const existing = prev.find(s => s.id === selectedId);
                            if (!existing) {
                              return [...prev, { id: selectedId, name: addOn.name, category: addOn.category, price: addOn.price, quantity: 1 }];
                            }
                                                        return prev;
                          });
                        }
                      }
                    }}>
                      {categoryItems.map(addOn => (
                        <IonSelectOption key={addOn.id} value={addOn.id}>
                          {addOn.name} - ₱{addOn.price}
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                  {selectedAddOns.filter(s => s.category === category).length > 0 && (
                    <IonList>
                      <IonListHeader>
                        <IonLabel>Selected {category} Items</IonLabel>
                      </IonListHeader>
                      {selectedAddOns.filter(s => s.category === category).map((selected) => (
                        <IonItem key={selected.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <IonLabel>{selected.name} - ₱{selected.price}</IonLabel>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <IonLabel style={{ marginRight: '5px' }}>Quantity:</IonLabel>
                            <IonInput type="number" min="0" value={selected.quantity} style={{ width: '60px' }} onIonChange={(e) => handleAddOnQuantityChange(selected.id, parseInt(e.detail.value!) || 0)} />
                            <IonButton color="danger" style={{ marginLeft: '10px' }} onClick={() => setSelectedAddOns(prev => prev.filter(s => s.id !== selected.id))}>Remove</IonButton>
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

        {/* Summary */}
        <div className="summary-section">
          <p className="summary-text">Time Started: {new Date(form.time_started).toLocaleTimeString("en-PH")}</p>
          <p className="summary-text">Time Ended: {new Date(getTimeEnded()).toLocaleTimeString("en-PH")}</p>
          <p className="summary-text">Total Hours: {totalHours}</p>
          <p className="summary-text">Time Amount: ₱{timeAmount.toFixed(2)}</p>
          {selectedAddOns.length > 0 && (
            <div>
              <p className="summary-text">Selected Add-Ons:</p>
              {selectedAddOns.map(s => (
                <p key={s.id} className="summary-text">{s.name} x{s.quantity} - ₱{(s.quantity * s.price).toFixed(2)}</p>
              ))}
              <p className="summary-text">Add-Ons Total: ₱{addOnsAmount.toFixed(2)}</p>
            </div>
          )}
          <p className="summary-text"><strong>Overall Total Amount: ₱{totalAmount.toFixed(2)}</strong></p>
          <p className="summary-text"><strong>Seats Selected: {form.seat_number.length > 0 ? form.seat_number.join(', ') : "None"}</strong></p>
          {form.reservation && (
            <p className="summary-text"><strong>Reservation Date: {form.reservation_date ? new Date(form.reservation_date).toLocaleDateString() : "None"}</strong></p>
          )}
        </div>

        <IonButton expand="block" className="submit-button" onClick={handleSubmit}>
          Save Record
        </IonButton>
      </div>
    </div>
  );
};

export default Staff_Dashboard;