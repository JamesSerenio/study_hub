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
  stocks: number; // generated
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
  onSaved: () => void; // parent will show alert + close on OK
  seatGroups: SeatGroup[];
};

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

export default function AddOnsModal({
  isOpen,
  onClose,
  onSaved,
  seatGroups,
}: Props) {
  const [addOns, setAddOns] = useState<AddOn[]>([]);

  const [addOnsFullName, setAddOnsFullName] = useState("");
  const [addOnsSeat, setAddOnsSeat] = useState("");

  // Each block just stores chosen category (duplicates allowed)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([""]);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOn[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchAddOns();

    // Ensure at least 1 block on open
    setSelectedCategories((prev) => (prev.length === 0 ? [""] : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fetchAddOns = async (): Promise<void> => {
    // ✅ Customer: show only in-stock items
    const { data, error } = await supabase
      .from("add_ons")
      .select("*")
      .gt("stocks", 0)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading add-ons.");
      return;
    }

    setAddOns((data as AddOn[]) || []);
  };

  const categories = useMemo(() => [...new Set(addOns.map((a) => a.category))], [addOns]);

  const addOnsTotal = useMemo(
    () => selectedAddOns.reduce((sum, s) => sum + s.quantity * s.price, 0),
    [selectedAddOns]
  );

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

  const handleAddOnQuantityChange = (id: string, quantity: number): void => {
    const q = Math.max(0, Math.floor(quantity));
    setSelectedAddOns((prev) => {
      const existing = prev.find((s) => s.id === id);

      if (q > 0) {
        if (existing) return prev.map((s) => (s.id === id ? { ...s, quantity: q } : s));
        const addOn = addOns.find((a) => a.id === id);
        if (!addOn) return prev;
        return [
          ...prev,
          { id, name: addOn.name, category: addOn.category, price: addOn.price, quantity: q },
        ];
      }

      return prev.filter((s) => s.id !== id);
    });
  };

  // ✅ Do NOT delete selected items when switching category
  const handleCategoryChange = (index: number, category: string): void => {
    setSelectedCategories((prev) => {
      const next = [...prev];
      next[index] = category;
      return next;
    });
  };

  // ✅ Removing a block should NOT delete items
  const removeCategoryBlock = (index: number): void => {
    setSelectedCategories((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [""] : next;
    });
  };

  const addAnotherCategory = (): void => {
    setSelectedCategories((prev) => [...prev, ""]);
  };

  const resetAddOnsForm = (): void => {
    setAddOnsFullName("");
    setAddOnsSeat("");
    setSelectedAddOns([]);
    setSelectedCategories([""]);
  };

  const handleSubmitAddOns = async (): Promise<void> => {
    const name = addOnsFullName.trim();
    if (!name) return alert("Full Name is required.");
    if (!addOnsSeat) return alert("Seat Number is required.");
    if (selectedAddOns.length === 0) return alert("Please select at least one add-on.");

    // ✅ Re-check stock before insert
    for (const selected of selectedAddOns) {
      const { data, error } = await supabase
        .from("add_ons")
        .select("stocks,name")
        .eq("id", selected.id)
        .single();

      if (error) {
        alert(`Stock check error for ${selected.name}: ${error.message}`);
        return;
      }

      const stocksNow = Number((data as { stocks: number }).stocks ?? 0);
      const nameNow = (data as { name: string }).name ?? selected.name;

      if (stocksNow < selected.quantity) {
        alert(`Insufficient stock for ${nameNow}. Available: ${stocksNow}`);
        return;
      }
    }

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

    // parent will show alert then close
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
            <IonInput
              value={addOnsFullName}
              placeholder="Enter full name"
              onIonChange={(e) => setAddOnsFullName(e.detail.value ?? "")}
            />
          </IonItem>

          <IonItem className="form-item">
            <IonLabel position="stacked">Seat Number *</IonLabel>
            <IonSelect
              value={addOnsSeat}
              placeholder="Choose seat"
              onIonChange={(e) => setAddOnsSeat(asString(e.detail.value))}
            >
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
            Add More Add-Ons
          </IonButton>

          {/* CATEGORY BLOCKS */}
          {selectedCategories.map((category, index) => {
            const categoryItems = addOns.filter((a) => a.category === category && a.stocks > 0);

            return (
              <div key={index} className="addon-block">
                <div className="addon-row">
                  <IonItem className="form-item addon-flex">
                    <IonLabel position="stacked">Select Category {index + 1}</IonLabel>
                    <IonSelect
                      value={category}
                      placeholder="Choose a category"
                      onIonChange={(e) => handleCategoryChange(index, asString(e.detail.value))}
                    >
                      {categories.map((cat) => (
                        <IonSelectOption key={`${cat}-${index}`} value={cat}>
                          {cat}
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>

                  <IonButton color="danger" onClick={() => removeCategoryBlock(index)}>
                    x
                  </IonButton>
                </div>

                {category && (
                  <IonItem className="form-item">
                    <IonLabel position="stacked">Select {category} Item</IonLabel>
                    <IonSelect
                      placeholder={categoryItems.length > 0 ? "Choose an item" : "No available items"}
                      disabled={categoryItems.length === 0}
                      onIonChange={(e) => {
                        const selectedId = asString(e.detail.value);
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
                          {/* ✅ NO stock shown */}
                          {a.name} - ₱{a.price}
                        </IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>
                )}
              </div>
            );
          })}

          {/* SELECTED ITEMS LIST */}
          {selectedAddOns.length > 0 && (
            <IonList style={{ marginTop: 12 }}>
              <IonListHeader>
                <IonLabel>Selected Items</IonLabel>
              </IonListHeader>

              {selectedSummaryByCategory.map(({ category, items }) => (
                <React.Fragment key={category}>
                  <IonListHeader>
                    <IonLabel>
                      <strong>{category}</strong>
                    </IonLabel>
                  </IonListHeader>

                  {items.map((selected) => (
                    <IonItem key={selected.id} className="addon-item">
                      <IonLabel>
                        <div style={{ fontWeight: 700 }}>{selected.name}</div>
                        <div style={{ opacity: 0.85 }}>₱{selected.price}</div>
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
                            const raw = (e.detail.value ?? "").toString();
                            const v = parseInt(raw, 10);
                            handleAddOnQuantityChange(selected.id, Number.isNaN(v) ? 0 : v);
                          }}
                        />

                        <IonButton
                          color="danger"
                          onClick={() =>
                            setSelectedAddOns((prev) => prev.filter((s) => s.id !== selected.id))
                          }
                        >
                          Remove
                        </IonButton>
                      </div>
                    </IonItem>
                  ))}
                </React.Fragment>
              ))}
            </IonList>
          )}

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
