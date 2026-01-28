// src/pages/Product_Item_Lists.tsx
// ✅ STRICT TS, NO any
// ✅ Add Expenses modal (logs to add_on_expenses)
// ✅ Expense Amount AUTO = qty * add_ons.expenses_cost (UNIT COST)
// ✅ If expenses_cost is 0 => fallback to price
// ✅ Sort by Category OR Stock (asc/desc)

import React, { useEffect, useMemo, useState } from "react";
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonGrid,
  IonRow,
  IonCol,
  IonLabel,
  IonButton,
  IonIcon,
  IonToast,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
  IonImg,
  IonModal,
  IonButtons,
  IonItem,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonList,
  IonSpinner,
} from "@ionic/react";
import {
  arrowUp,
  arrowDown,
  closeOutline,
  addCircleOutline,
  swapVerticalOutline,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import type {
  IonInputCustomEvent,
  InputInputEventDetail,
  IonSelectCustomEvent,
  SelectChangeEventDetail,
  TextareaInputEventDetail,
  IonTextareaCustomEvent,
} from "@ionic/core";

type ExpenseType = "expired" | "staff_consumed";
type SortKey = "category" | "stocks";

interface AddOn {
  id: string;
  category: string;
  name: string;

  price: number | string;
  restocked: number | string;
  sold: number | string;

  // ✅ expenses_cost = UNIT COST (money)
  // ✅ expenses = count/qty logged (not money)
  expenses_cost: number | string;
  expenses: number | string;

  stocks: number | string;
  overall_sales: number | string;
  expected_sales: number | string;
  image_url: string | null;

  expired: number | string;
  staff_consumed: number | string;
}

interface AddOnExpenseInsert {
  add_on_id: string;
  full_name: string;
  category: string;
  product_name: string;
  quantity: number;
  expense_type: ExpenseType;
  expense_amount: number; // ✅ AUTO money
  description: string;
}

/* =========================
   SAFE PARSE HELPERS
========================= */

const toNumber = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const clampInt = (raw: string, fallback = 0): number => {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const n = Math.floor(Number(trimmed));
  return Number.isFinite(n) ? n : fallback;
};

const money2 = (n: number): string => `₱${n.toFixed(2)}`;

/* =========================
   AUTO COMPUTE
========================= */

type UnitSource = "cost" | "price" | "none";

const getUnitCost = (addOn: AddOn | null): { unit: number; source: UnitSource } => {
  if (!addOn) return { unit: 0, source: "none" };

  const cost = toNumber(addOn.expenses_cost);
  if (cost > 0) return { unit: cost, source: "cost" };

  // ✅ fallback to price if cost is not set
  const price = toNumber(addOn.price);
  if (price > 0) return { unit: price, source: "price" };

  return { unit: 0, source: "none" };
};

const computeExpenseAmount = (addOn: AddOn | null, qtyStr: string): number => {
  if (!addOn) return 0;
  const q = clampInt(qtyStr, 0);
  const { unit } = getUnitCost(addOn);
  const total = q * unit;
  return Number.isFinite(total) ? total : 0;
};

/* =========================
   PAGE
========================= */

const Product_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // sort controls
  const [sortKey, setSortKey] = useState<SortKey>("category");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // modal
  const [isExpenseOpen, setIsExpenseOpen] = useState<boolean>(false);
  const [savingExpense, setSavingExpense] = useState<boolean>(false);

  // form
  const [fullName, setFullName] = useState<string>("");
  const [selectedAddOnId, setSelectedAddOnId] = useState<string>("");
  const [expenseType, setExpenseType] = useState<ExpenseType>("expired");
  const [qty, setQty] = useState<string>("1");
  const [expenseAmount, setExpenseAmount] = useState<string>("0"); // auto
  const [description, setDescription] = useState<string>("");

  const fetchAddOns = async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select(
          "id, created_at, category, name, price, restocked, sold, expenses_cost, expenses, stocks, overall_sales, expected_sales, image_url, expired, staff_consumed"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAddOns((data ?? []) as AddOn[]);
    } catch (err) {
      console.error("Error fetching add-ons:", err);
      setToastMessage("Error loading products. Please try again.");
      setShowToast(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAddOns();
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>): void => {
    void fetchAddOns().finally(() => event.detail.complete());
  };

  const sortedAddOns = useMemo(() => {
    const list = [...addOns];

    list.sort((a, b) => {
      if (sortKey === "category") {
        const aCat = (a.category ?? "").toString();
        const bCat = (b.category ?? "").toString();
        return sortOrder === "asc" ? aCat.localeCompare(bCat) : bCat.localeCompare(aCat);
      }
      const aStock = toNumber(a.stocks);
      const bStock = toNumber(b.stocks);
      return sortOrder === "asc" ? aStock - bStock : bStock - aStock;
    });

    return list;
  }, [addOns, sortKey, sortOrder]);

  const toggleSortOrder = (): void => {
    setSortOrder((p) => (p === "asc" ? "desc" : "asc"));
  };

  const selectedAddOn = useMemo(() => {
    return addOns.find((a) => a.id === selectedAddOnId) ?? null;
  }, [addOns, selectedAddOnId]);

  // ✅ AUTO recompute when product or qty changes
  useEffect(() => {
    const total = computeExpenseAmount(selectedAddOn, qty);
    setExpenseAmount(String(total));
  }, [selectedAddOn?.id, qty]);

  const openExpenseModal = (): void => {
    setFullName("");
    setSelectedAddOnId("");
    setExpenseType("expired");
    setQty("1");
    setExpenseAmount("0");
    setDescription("");
    setIsExpenseOpen(true);
  };

  const closeExpenseModal = (): void => {
    if (savingExpense) return;
    setIsExpenseOpen(false);
  };

  const validateExpense = (): string | null => {
    const name = fullName.trim();
    if (!name) return "Full name is required.";
    if (!selectedAddOnId) return "Please select a product.";

    const q = clampInt(qty, -1);
    if (q <= 0) return "Quantity must be at least 1.";

    const desc = description.trim();
    if (!desc) return "Description / reason is required.";

    if (selectedAddOn) {
      const stock = toNumber(selectedAddOn.stocks);
      if (q > stock) return `Not enough stock. Available: ${stock}`;
    }

    // ✅ prevent saving if both cost and price are 0 (no basis)
    if (selectedAddOn) {
      const { unit, source } = getUnitCost(selectedAddOn);
      if (unit <= 0 || source === "none") return "Set expenses_cost (unit cost) or price first (cannot compute).";
    }

    return null;
  };

  const submitExpense = async (): Promise<void> => {
    const err = validateExpense();
    if (err) {
      setToastMessage(err);
      setShowToast(true);
      return;
    }
    if (!selectedAddOn) {
      setToastMessage("Product not found.");
      setShowToast(true);
      return;
    }

    const q = clampInt(qty, 1);

    const payload: AddOnExpenseInsert = {
      add_on_id: selectedAddOn.id,
      full_name: fullName.trim(),
      category: selectedAddOn.category,
      product_name: selectedAddOn.name,
      quantity: q,
      expense_type: expenseType,
      expense_amount: computeExpenseAmount(selectedAddOn, String(q)),
      description: description.trim(),
    };

    setSavingExpense(true);
    try {
      const { error } = await supabase.from("add_on_expenses").insert(payload);
      if (error) throw error;

      setToastMessage("Expense recorded.");
      setShowToast(true);

      setIsExpenseOpen(false);
      await fetchAddOns();
    } catch (e) {
      console.error("Error saving expense:", e);
      setToastMessage("Failed to save expense. Please try again.");
      setShowToast(true);
    } finally {
      setSavingExpense(false);
    }
  };

  const unitInfo = useMemo(() => getUnitCost(selectedAddOn), [selectedAddOn?.id]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Product Item Lists</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {/* TOP ACTIONS */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <IonButton onClick={openExpenseModal}>
            <IonIcon slot="start" icon={addCircleOutline} />
            Add Expenses
          </IonButton>

          <IonItem lines="none" style={{ maxWidth: 260 }}>
            <IonLabel>Sort</IonLabel>
            <IonSelect
              value={sortKey}
              onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) =>
                setSortKey(String(e.detail.value) as SortKey)
              }
            >
              <IonSelectOption value="category">Category</IonSelectOption>
              <IonSelectOption value="stocks">Stocks</IonSelectOption>
            </IonSelect>
          </IonItem>

          <IonButton fill="clear" onClick={toggleSortOrder}>
            <IonIcon slot="start" icon={swapVerticalOutline} />
            {sortOrder === "asc" ? (
              <>
                Asc <IonIcon icon={arrowUp} />
              </>
            ) : (
              <>
                Desc <IonIcon icon={arrowDown} />
              </>
            )}
          </IonButton>
        </div>

        {loading ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <IonSpinner />
            <IonLabel>Loading products...</IonLabel>
          </div>
        ) : (
          <IonGrid>
            <IonRow>
              <IonCol>Image</IonCol>
              <IonCol>Name</IonCol>
              <IonCol>Category</IonCol>
              <IonCol>Price</IonCol>
              <IonCol>Restocked</IonCol>
              <IonCol>Sold</IonCol>
              <IonCol>Expired</IonCol>
              <IonCol>Staff Used</IonCol>
              <IonCol>Stocks</IonCol>
              <IonCol>Expenses (count)</IonCol>
              <IonCol>Unit Cost</IonCol>
              <IonCol>Overall Sales</IonCol>
              <IonCol>Expected Sales</IonCol>
            </IonRow>

            {sortedAddOns.length > 0 ? (
              sortedAddOns.map((a) => (
                <IonRow key={a.id}>
                  <IonCol>
                    {a.image_url ? (
                      <IonImg
                        src={a.image_url}
                        alt={a.name}
                        style={{ width: "50px", height: "50px", objectFit: "cover" }}
                      />
                    ) : (
                      <IonLabel>No Image</IonLabel>
                    )}
                  </IonCol>

                  <IonCol>{a.name}</IonCol>
                  <IonCol>{a.category}</IonCol>
                  <IonCol>{money2(toNumber(a.price))}</IonCol>
                  <IonCol>{toNumber(a.restocked)}</IonCol>
                  <IonCol>{toNumber(a.sold)}</IonCol>
                  <IonCol>{toNumber(a.expired)}</IonCol>
                  <IonCol>{toNumber(a.staff_consumed)}</IonCol>
                  <IonCol>{toNumber(a.stocks)}</IonCol>
                  <IonCol>{toNumber(a.expenses)}</IonCol>
                  <IonCol>{money2(toNumber(a.expenses_cost))}</IonCol>
                  <IonCol>{money2(toNumber(a.overall_sales))}</IonCol>
                  <IonCol>{money2(toNumber(a.expected_sales))}</IonCol>
                </IonRow>
              ))
            ) : (
              <IonRow>
                <IonCol size="12">No products found.</IonCol>
              </IonRow>
            )}
          </IonGrid>
        )}

        {/* ADD EXPENSES MODAL */}
        <IonModal isOpen={isExpenseOpen} onDidDismiss={closeExpenseModal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Add Expenses</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={closeExpenseModal} disabled={savingExpense}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="ion-padding">
            <IonList>
              <IonItem>
                <IonLabel position="stacked">Full Name (staff)</IonLabel>
                <IonInput
                  value={fullName}
                  placeholder="Enter staff full name"
                  onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) =>
                    setFullName(String(e.detail.value ?? ""))
                  }
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Product</IonLabel>
                <IonSelect
                  value={selectedAddOnId}
                  placeholder="Select product"
                  onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) =>
                    setSelectedAddOnId(String(e.detail.value ?? ""))
                  }
                >
                  {addOns.map((a) => (
                    <IonSelectOption key={a.id} value={a.id}>
                      {a.category} — {a.name} (Stock: {toNumber(a.stocks)})
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Type</IonLabel>
                <IonSelect
                  value={expenseType}
                  onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) =>
                    setExpenseType(e.detail.value as ExpenseType)
                  }
                >
                  <IonSelectOption value="expired">Expired / Damaged</IonSelectOption>
                  <IonSelectOption value="staff_consumed">Staff Consumed</IonSelectOption>
                </IonSelect>
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Quantity</IonLabel>
                <IonInput
                  inputMode="numeric"
                  value={qty}
                  placeholder="1"
                  onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) =>
                    setQty(String(e.detail.value ?? ""))
                  }
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Expense Amount (auto)</IonLabel>
                <IonInput inputMode="decimal" value={expenseAmount} readonly />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Description / Reason</IonLabel>
                <IonTextarea
                  value={description}
                  placeholder="Example: expired date reached / staff snack / damaged packaging"
                  autoGrow
                  onIonInput={(e: IonTextareaCustomEvent<TextareaInputEventDetail>) =>
                    setDescription(String(e.detail.value ?? ""))
                  }
                />
              </IonItem>
            </IonList>

            {selectedAddOn && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 12,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Selected Product</div>
                <div>Name: {selectedAddOn.name}</div>
                <div>Category: {selectedAddOn.category}</div>
                <div>Current Stock: {toNumber(selectedAddOn.stocks)}</div>

                <div style={{ marginTop: 8 }}>
                  Unit Source:{" "}
                  <b>
                    {unitInfo.source === "cost"
                      ? "expenses_cost"
                      : unitInfo.source === "price"
                      ? "price (fallback)"
                      : "none"}
                  </b>
                </div>
                <div>Unit Used: <b>{money2(unitInfo.unit)}</b></div>
                <div>
                  Total: <b>{money2(computeExpenseAmount(selectedAddOn, qty))}</b>
                </div>

                {unitInfo.source === "price" && (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    Note: expenses_cost is 0, so we used price as fallback. Set expenses_cost to match your real unit cost.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <IonButton expand="block" onClick={submitExpense} disabled={savingExpense}>
                {savingExpense ? "Saving..." : "Save Expense"}
              </IonButton>
              <IonButton expand="block" fill="outline" onClick={closeExpenseModal} disabled={savingExpense}>
                Cancel
              </IonButton>
            </div>
          </IonContent>
        </IonModal>

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={3000}
          onDidDismiss={() => setShowToast(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default Product_Item_Lists;
