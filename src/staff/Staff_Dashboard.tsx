import React, { useEffect, useState } from "react";
import {
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonList,
  IonListHeader,
} from "@ionic/react";
import { supabase } from "../utils/supabaseClient";

const HOURLY_RATE = 20;
const ITEMS_THRESHOLD = 5; // If more than 5 items in category, use select instead of list

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
  });

  // 🔹 AUTO time started (PH time)
  const [timeStarted] = useState<string>(new Date().toISOString());

  // 🔹 STAFF INPUT (HH:MM)
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

  // 🧮 Convert HH:MM → hours
  const getTotalHours = (): number => {
    const [h, m] = timeAvail.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
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

  const cancelAddOns = () => {
    setShowAddOns(false);
    setSelectedCategories([]);
    setSelectedAddOns([]);
  };

  const handleSubmit = async (): Promise<void> => {
    if (!profile || totalHours <= 0) {
      alert("Invalid time avail");
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

    // Update add-ons
    for (const selected of selectedAddOns) {
      const addOn = addOns.find(a => a.id === selected.id);
      if (addOn) {
        const newSold = addOn.sold + selected.quantity;
        const newOverallSales = addOn.overall_sales + (selected.quantity * addOn.price);
        const { error } = await supabase
          .from("add_ons")
          .update({
            sold: newSold,
            overall_sales: newOverallSales,
          })
          .eq("id", selected.id);
        if (error) {
          alert(`Error updating ${selected.name}: ${error.message}`);
          return;
        }
      }
    }

    // Insert customer session
    const { error } = await supabase.from("customer_sessions").insert({
      staff_id: auth.user.id,
      date: new Date().toISOString().split("T")[0],
      full_name: form.full_name,
      customer_type: form.customer_type,
      customer_field: form.customer_field,
      has_id: form.has_id,
      hour_avail: timeAvail,
      time_started: timeStarted,
      time_ended: getTimeEnded(),
      total_hours: totalHours,
      total_amount: totalAmount,
      add_ons: selectedAddOns, // Assuming you add this field as jsonb in the table
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Customer session saved!");
      // Reset form
      setForm({
        full_name: "",
        customer_type: "",
        customer_field: "",
        has_id: false,
      });
      setTimeAvail("01:00");
      setSelectedAddOns([]);
      setSelectedCategories([]);
      setShowAddOns(false);
      fetchAddOns(); // Refresh add-ons to update stocks
    }
  };

  return (
    <div className="staff-dashboard">
      <h2 className="form-title">Customer Time Form</h2>

      <div className="form-container">
        <IonItem className="form-item">
          <IonLabel position="stacked">Full Name</IonLabel>
          <IonInput
            value={form.full_name}
            onIonChange={(e) =>
              setForm({ ...form, full_name: e.detail.value ?? "" })
            }
          />
        </IonItem>

        <IonItem className="form-item">
          <IonLabel position="stacked">Customer Type</IonLabel>
          <IonSelect
            value={form.customer_type}
            onIonChange={(e) =>
              setForm({ ...form, customer_type: e.detail.value })
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
            onIonChange={(e) =>
              setForm({ ...form, customer_field: e.detail.value ?? "" })
            }
          />
        </IonItem>

        {/* ⏱ TIME AVAIL - Changed to text input for HH:MM only, no AM/PM */}
        <IonItem className="form-item">
          <IonLabel position="stacked">Time Avail (HH:MM)</IonLabel>
          <IonInput
            type="text"
            placeholder="HH:MM (e.g., 01:00 for 1 hour, 00:30 for 30 mins)"
            value={timeAvail}
            onIonChange={(e) => {
              const value = e.detail.value ?? "";
              // Basic validation: ensure format is HH:MM
              if (/^\d{2}:\d{2}$/.test(value)) {
                setTimeAvail(value);
              } else if (value === "") {
                setTimeAvail("");
              }
              // If invalid, don't update (or you could show an error)
            }}
          />
        </IonItem>

        {/* Add-Ons Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <IonButton expand="block" onClick={handleAddOnsClick}>
            {showAddOns ? "Add More Add-Ons" : "Add-Ons"}
          </IonButton>
          {showAddOns && (
            <IonButton expand="block" color="danger" onClick={cancelAddOns}>
              Cancel Add-Ons
            </IonButton>
          )}
        </div>

        {/* Add-Ons Section - Only show if showAddOns is true */}
        {showAddOns && selectedCategories.map((category, index) => {
          const categoryItems = addOns.filter(a => a.category === category);
          const useSelect = categoryItems.length > ITEMS_THRESHOLD;

          return (
            <div key={index}>
              <IonItem className="form-item">
                <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                <IonSelect
                  value={category}
                  placeholder="Choose a category"
                  onIonChange={(e) => handleCategoryChange(index, e.detail.value)}
                >
                  {categories.map(cat => (
                    <IonSelectOption key={cat} value={cat}>{cat}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>

              {category && (
                <>
                  {useSelect ? (
                    // Use select for many items
                    <IonItem className="form-item">
                      <IonLabel position="stacked">Select {category} Item</IonLabel>
                      <IonSelect
                        placeholder="Choose an item"
                        onIonChange={(e) => {
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
                        }}
                      >
                        {categoryItems.map(addOn => (
                          <IonSelectOption key={addOn.id} value={addOn.id}>
                            {addOn.name} - ₱{addOn.price}
                          </IonSelectOption>
                        ))}
                      </IonSelect>
                    </IonItem>
                  ) : (
                    // Use list for few items
                    <IonList style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      <IonListHeader>
                        <IonLabel>{category} Items</IonLabel>
                      </IonListHeader>
                      {categoryItems.map((addOn) => (
                        <IonItem key={addOn.id}>
                          <IonLabel>{addOn.name} - ₱{addOn.price}</IonLabel>
                          <IonInput
                            type="number"
                            placeholder="Qty"
                            min="0"
                            value={selectedAddOns.find(s => s.id === addOn.id)?.quantity || 0}
                            onIonChange={(e) => handleAddOnQuantityChange(addOn.id, parseInt(e.detail.value!) || 0)}
                          />
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
          <p className="summary-text">
            Time Started: {new Date(timeStarted).toLocaleTimeString("en-PH")}
          </p>
          <p className="summary-text">
            Time Ended: {new Date(getTimeEnded()).toLocaleTimeString("en-PH")}
          </p>
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