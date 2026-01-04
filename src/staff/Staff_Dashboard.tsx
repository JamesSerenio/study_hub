import React, { useEffect, useState } from "react";
import { IonButton, IonInput, IonItem, IonLabel, IonSelect, IonSelectOption, IonList, IonListHeader, IonToggle, } from "@ionic/react";
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
  id_number: string; // Specific ID
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
    id_number: "", // Initialize
  });

  // 🔹 AUTO time started (PH time)
  const [timeStarted] = useState<string>(new Date().toISOString()); // 🔹 STAFF INPUT (HH:MM) - Prevent empty
  const [timeAvail, setTimeAvail] = useState<string>("01:00");

  useEffect(() => {
    fetchProfile();
    fetchAddOns();
  }, []);

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

  // 🧮 Convert HH:MM → hours (improved to handle edge cases)
  const getTotalHours = (): number => {
    if (!timeAvail || !timeAvail.includes(":")) return 0;
    const [h, m] = timeAvail.split(":").map(Number);
    if (isNaN(h) || isNaN(m) || h < 0 || m < 0 || m > 59) return 0;
    return Number((h + m / 60).toFixed(2));
  };

  // ⏰ Auto end time
  const getTimeEnded = (): string => {
    const start = new Date(timeStarted);
    const [h, m] = timeAvail.split(":").map(Number);
    start.setHours(start.getHours() + h);
    start.setMinutes(start.getMinutes() + m);
    return start.toISOString();
  };

  const totalHours = getTotalHours();
  const timeAmount = totalHours * HOURLY_RATE;
  const addOnsAmount = selectedAddOns.reduce((sum, s) => sum + (s.quantity * s.price), 0);
  const totalAmount = timeAmount + addOnsAmount;

  // Get unique categories
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
    // Remove selected add-ons for this category
    setSelectedAddOns(prev => prev.filter(s => s.category !== categoryToRemove));
  };

  const handleAddOnsClick = () => {
    if (!showAddOns) {
      // First tap: show add-ons and add first category
      setShowAddOns(true);
      setSelectedCategories([""]);
    } else {
      // Subsequent taps: add more categories
      setSelectedCategories(prev => [...prev, ""]);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    console.log("timeAvail:", timeAvail, "totalHours:", totalHours); // Debug
    if (!profile) {
      alert("You must be logged in as staff to save records.");
      return;
    }
    if (totalHours <= 0) {
      alert("Invalid time avail - Please enter a valid time (e.g., 01:00)");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    // Validate add-on quantities against stocks
    for (const selected of selectedAddOns) {
      const addOn = addOns.find(a => a.id === selected.id);
      if (!addOn || addOn.stocks < selected.quantity) {
        alert(`Insufficient stock for ${selected.name}. Available: ${addOn?.stocks || 0}`);
        return;
      }
    }
    // Insert customer session first
    const { data: sessionData, error: sessionError } = await supabase
      .from("customer_sessions")
      .insert({
        staff_id: auth.user.id,
        date: new Date().toISOString().split("T")[0],
        full_name: form.full_name,
        customer_type: form.customer_type,
        customer_field: form.customer_field,
        has_id: form.has_id,
        id_number: form.id_number,
        hour_avail: timeAvail,
        time_started: timeStarted,
        time_ended: getTimeEnded(),
        total_hours: totalHours,
        total_amount: totalAmount,
      })
      .select("id")
      .single();
    if (sessionError) {
      alert(`Error saving session: ${sessionError.message}`);
      return;
    }
    const sessionId = sessionData.id;
    // Insert add-ons into customer_session_add_ons (trigger will update sales)
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
    // Reset form
    setForm({
      full_name: "",
      customer_type: "",
      customer_field: "",
      has_id: false,
      id_number: "",
    });
    setTimeAvail("01:00");
    setSelectedAddOns([]);
    setSelectedCategories([]);
    setShowAddOns(false);
    fetchAddOns(); // Refresh add-ons to update stocks
  };

  return (
    <div className="staff-dashboard">
      <h2 className="form-title">Customer Time Form</h2>
      <div className="form-container">
        <IonItem className="form-item">
          <IonLabel position="stacked">Full Name</IonLabel>
          <IonInput value={form.full_name} onIonChange={(e) => setForm({ ...form, full_name: e.detail.value ?? "" })} />
        </IonItem>
        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Type</IonLabel>
          <IonSelect value={form.customer_type} onIonChange={(e) => setForm({ ...form, customer_type: e.detail.value })}>
            <IonSelectOption value="reviewer">Reviewer</IonSelectOption>
            <IonSelectOption value="student">Student</IonSelectOption>
            <IonSelectOption value="regular">Regular</IonSelectOption>
          </IonSelect>
        </IonItem>
        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Field</IonLabel>
          <IonInput value={form.customer_field} onIonChange={(e) => setForm({ ...form, customer_field: e.detail.value ?? "" })} />
        </IonItem>
        {/* ID Toggle with With/Without labels */}
        <IonItem className="form-item">
          <IonLabel>ID</IonLabel>
          <IonToggle checked={form.has_id} onIonChange={(e) => setForm({ ...form, has_id: e.detail.checked })} />
          <IonLabel slot="end">{form.has_id ? 'With' : 'Without'}</IonLabel>
        </IonItem>
        {/* Conditional Specific ID Input */}
        {form.has_id && (
          <IonItem className="form-item">
            <IonLabel position="stacked">Specific ID</IonLabel>
            <IonInput value={form.id_number} placeholder="e.g., National ID, Student ID, etc." onIonChange={(e) => setForm({ ...form, id_number: e.detail.value ?? "" })} />
          </IonItem>
        )}
        {/* ⏱ TIME AVAIL - Improved validation to accept 1:0 or 01:00, auto-pad both hours and minutes, prevent empty or zero time */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Time Avail (HH:MM)</IonLabel>
          <IonInput
            type="text"
            placeholder="HH:MM (e.g., 1:00 for 1 hour, 0:30 for 30 mins)"
            value={timeAvail}
            onIonChange={(e) => {
              const value = e.detail.value ?? "";
              // Improved validation: allow 1:0 or 01:00, auto-pad both hours and minutes, prevent empty or zero time
              const match = value.match(/^(\d{1,2}):(\d{1,2})$/);
              if (match) {
                const h = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                if (h >= 0 && h <= 23 && m >= 0 && m <= 59 && (h > 0 || m > 0)) {
                  // Prevent 00:00
                  const paddedH = h.toString().padStart(2, '0');
                  const paddedM = m.toString().padStart(2, '0');
                  setTimeAvail(`${paddedH}:${paddedM}`);
                }
              } else if (value === "") {
                // Prevent empty, reset to default
                setTimeAvail("01:00");
              }
            }}
          />
        </IonItem>
        {/* Add-Ons Button */}
        <IonButton expand="block" onClick={handleAddOnsClick}>
          {showAddOns ? "Add More Add-Ons" : "Add-Ons"}
        </IonButton>
        {/* Add-Ons Section - Only show if showAddOns is true */}
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
                  {/* Selected items for this category */}
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
        <div className="summary-section">
          <p className="summary-text">Time Started: {new Date(timeStarted).toLocaleTimeString("en-PH")}</p>
          <p className="summary-text">Time Ended: {new Date(getTimeEnded()).toLocaleTimeString("en-PH")}</p>
          <p className="summary-text">Total Hours: {totalHours}</p>
          <p className="summary-text">Time Amount: ₱{timeAmount.toFixed(2)}</p>
          {selectedAddOns.length > 0 && (
            <div>
              <p className="summary-text">Selected Add-Ons:</p>
              {selectedAddOns.map(s => (
                <p key={s.id} className="summary-text">
                  {s.name} x{s.quantity} - ₱{(s.quantity * s.price).toFixed(2)}
                </p>
              ))}
              <p className="summary-text">Add-Ons Total: ₱{addOnsAmount.toFixed(2)}</p>
            </div>
          )}
          <p className="summary-text"><strong>Overall Total Amount: ₱{totalAmount.toFixed(2)}</strong></p>
        </div>
        <IonButton expand="block" className="submit-button" onClick={handleSubmit}>
          Save Record
        </IonButton>
      </div>
    </div>
  );
};

export default Staff_Dashboard;