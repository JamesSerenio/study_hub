// src/components/AddOnsModal.tsx
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
  IonList,
  IonListHeader,
} from "@ionic/react";
import { closeOutline } from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";

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

type SeatGroup = { title: string; seats: string[] };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void; // parent opens thank-you modal
  seatGroups: SeatGroup[];
};

export default function AddOnsModal({ isOpen, onClose, onSaved, seatGroups }: Props) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);

  // Required fields for customer_session_add_ons
  const [addOnsFullName, setAddOnsFullName] = useState("");
  const [addOnsSeat, setAddOnsSeat] = useState("");

  // category blocks
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showAddOns, setShowAddOns] = useState(false);

  // selected items (across categories)
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchAddOns();
    // ensure at least 1 category block if user opens modal
    if (!showAddOns) {
      setShowAddOns(true);
      setSelectedCategories([""]);
    } else if (selectedCategories.length === 0) {
      setSelectedCategories([""]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fetchAddOns = async (): Promise<void> => {
    const { data, error } = await supabase.from("add_ons").select("*").order("category", { ascending: true });
    if (error) {
      console.error(error);
      alert("Error loading add-ons.");
      return;
    }
    setAddOns((data as AddOn[]) || []);
  };

  const categories = useMemo(() => [...new Set(addOns.map((a) => a.category))], [addOns]);

  const addOnsByCategory = (category: string) => selectedAddOns.filter((s) => s.category === category);

  const addOnsTotal = useMemo(
    () => selectedAddOns.reduce((sum, s) => sum + s.quantity * s.price, 0),
    [selectedAddOns]
  );

  // ✅ visible summary even if user adds many blocks
  const selectedSummaryByCategory = useMemo(() => {
    const map = new Map<string, SelectedAddOn[]>();
    for (const item of selectedAddOns) {
      const cat = item.category || "Uncategorized";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items: items.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [selectedAddOns]);

  const selectedCategoryNames = useMemo(
    () => selectedSummaryByCategory.map((x) => x.category),
    [selectedSummaryByCategory]
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
    if (!name) return alert("Full Name is required.");
    if (!addOnsSeat) return alert("Seat Number is required.");
    if (selectedAddOns.length === 0) return alert("Please select at least one add-on.");

    // stock check
    for (const selected of selectedAddOns) {
      const addOn = addOns.find((a) => a.id === selected.id);
      if (!addOn || addOn.stocks < selected.quantity) {
        alert(`Insufficient stock for ${selected.name}. Available: ${addOn?.stocks ?? 0}`);
        return;
      }
    }

    // insert per item based on your table:
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

    void fetchAddOns();
    onClose();
    onSaved();
    resetAddOnsForm();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Add-Ons</IonTitle>
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
            <IonLabel position="stacked">Full Name *</IonLabel>
            <IonInput value={addOnsFullName} placeholder="Enter full name" onIonChange={(e) => setAddOnsFullName(e.detail.value ?? "")} />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Seat Number *</IonLabel>
            <IonSelect value={addOnsSeat} placeholder="Choose seat" onIonChange={(e) => setAddOnsSeat(e.detail.value)}>
              {seatGroups.map((g) => (
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
                      <IonSelect value={category} placeholder="Choose a category" onIonChange={(e) => handleCategoryChange(index, (e.detail.value as string) ?? "")}>
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
                                { id: selectedId, name: addOn.name, category: addOn.category, price: addOn.price, quantity: 1 },
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
                                <div style={{ marginTop: 4, fontWeight: 700 }}>Subtotal: ₱{(selected.price * selected.quantity).toFixed(2)}</div>
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
                                <IonButton color="danger" onClick={() => setSelectedAddOns((prev) => prev.filter((s) => s.id !== selected.id))}>
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

          {/* ✅ ORDER SUMMARY */}
          {selectedAddOns.length > 0 && (
            <div className="addon-summary">
              <p className="addon-summary-title">Order Summary</p>

              <IonList>
                {selectedSummaryByCategory.map(({ category, items }) => (
                  <React.Fragment key={category}>
                    <IonListHeader>
                      <IonLabel>
                        <strong>{category}</strong>
                      </IonLabel>
                    </IonListHeader>

                    {items.map((it) => (
                      <IonItem key={it.id}>
                        <IonLabel>
                          <div style={{ fontWeight: 700 }}>{it.name}</div>
                          <div style={{ opacity: 0.85 }}>
                            Qty: {it.quantity} × ₱{it.price} = <strong>₱{(it.quantity * it.price).toFixed(2)}</strong>
                          </div>
                        </IonLabel>
                      </IonItem>
                    ))}
                  </React.Fragment>
                ))}
              </IonList>

              <p className="addon-summary-cats">
                <strong>Categories:</strong> {selectedCategoryNames.join(", ")}
              </p>
            </div>
          )}

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
  );
}
