// src/pages/Product_Item_Lists.tsx
// ✅ STRICT TS, NO any
// ✅ Stock Adjustment uses RPC: record_addon_adjustment (fixes "stocks can only be updated to DEFAULT")
// ✅ Types: Expired/Damaged, Inventory Loss, Bilin
// ✅ ALL: -stock
// ✅ Bilin + Inventory Loss: +overall (handled by DB generated overall_sales)
// ✅ Expired/Damaged: -stock only (not included in overall_sales)
// ✅ Inventory Loss label replaces staff consume
// ✅ Keeps SAME pil-* classnames

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
  searchOutline,
  cashOutline,
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

type ExpenseType = "expired" | "inventory_loss" | "bilin";
type SortKey = "category" | "stocks";
type CashOutMethod = "cash" | "gcash";

interface AddOn {
  id: string;
  category: string;
  name: string;
  size: string | null;

  price: number | string;
  restocked: number | string;
  sold: number | string;

  expenses_cost: number | string; // unit cost
  expenses: number | string; // qty tracker (expired+inventory_loss)

  stocks: number | string;
  overall_sales: number | string;
  expected_sales: number | string;
  image_url: string | null;

  expired: number | string;
  inventory_loss: number | string;
  bilin: number | string;
}

interface CashOutInsert {
  type: string;
  description: string | null;
  amount: number;
  payment_method: CashOutMethod;
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

const clampMoney = (raw: string, fallback = 0): number => {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
};

const money2 = (n: number): string => `₱${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;

const normSize = (s: string | null | undefined): string | null => {
  const v = String(s ?? "").trim();
  return v.length ? v : null;
};

/* =========================
   AUTH HELPERS
========================= */

const getAuthedUserId = async (): Promise<string | null> => {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("getUser error:", error);
    return null;
  }
  return data.user?.id ?? null;
};

/* =========================
   UNIT COST RULES
========================= */

type UnitSource = "cost" | "price" | "none";

// expired => use expenses_cost fallback price
// inventory_loss + bilin => use price (because affects overall)
const getUnitForType = (addOn: AddOn | null, t: ExpenseType): { unit: number; source: UnitSource } => {
  if (!addOn) return { unit: 0, source: "none" };

  const price = toNumber(addOn.price);
  const cost = toNumber(addOn.expenses_cost);

  if (t === "bilin" || t === "inventory_loss") {
    return price > 0 ? { unit: price, source: "price" } : { unit: 0, source: "none" };
  }

  // expired
  if (cost > 0) return { unit: cost, source: "cost" };
  if (price > 0) return { unit: price, source: "price" };
  return { unit: 0, source: "none" };
};

const computeAmount = (addOn: AddOn | null, t: ExpenseType, qtyStr: string): number => {
  if (!addOn) return 0;
  const q = clampInt(qtyStr, 0);
  const { unit } = getUnitForType(addOn, t);
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

  const [sortKey, setSortKey] = useState<SortKey>("category");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const [search, setSearch] = useState<string>("");

  // STOCK ADJUST modal
  const [isExpenseOpen, setIsExpenseOpen] = useState<boolean>(false);
  const [savingExpense, setSavingExpense] = useState<boolean>(false);

  // form
  const [fullName, setFullName] = useState<string>("");
  const [selectedAddOnId, setSelectedAddOnId] = useState<string>("");
  const [expenseType, setExpenseType] = useState<ExpenseType>("expired");
  const [qty, setQty] = useState<string>("1");
  const [expenseAmount, setExpenseAmount] = useState<string>("0");
  const [description, setDescription] = useState<string>("");

  // CASH OUTS modal
  const [isCashOutOpen, setIsCashOutOpen] = useState<boolean>(false);
  const [savingCashOut, setSavingCashOut] = useState<boolean>(false);

  // CASH OUTS form
  const [cashOutType, setCashOutType] = useState<string>("");
  const [cashOutDesc, setCashOutDesc] = useState<string>("");
  const [cashOutAmount, setCashOutAmount] = useState<string>("");
  const [cashOutMethod, setCashOutMethod] = useState<CashOutMethod>("cash");

  const fetchAddOns = async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select(
          "id, created_at, category, name, size, price, restocked, sold, expenses_cost, expenses, stocks, overall_sales, expected_sales, image_url, expired, inventory_loss, bilin"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAddOns((data ?? []) as AddOn[]);
    } catch (err) {
      // eslint-disable-next-line no-console
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

  const filteredAddOns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedAddOns;

    return sortedAddOns.filter((a) => {
      const name = (a.name ?? "").toString().toLowerCase();
      const cat = (a.category ?? "").toString().toLowerCase();
      const size = (a.size ?? "").toString().toLowerCase();
      return name.includes(q) || cat.includes(q) || size.includes(q);
    });
  }, [sortedAddOns, search]);

  const toggleSortOrder = (): void => {
    setSortOrder((p) => (p === "asc" ? "desc" : "asc"));
  };

  const selectedAddOn = useMemo(() => addOns.find((a) => a.id === selectedAddOnId) ?? null, [addOns, selectedAddOnId]);

  useEffect(() => {
    const total = computeAmount(selectedAddOn, expenseType, qty);
    setExpenseAmount(String(total));
  }, [selectedAddOn?.id, expenseType, qty]);

  /* =========================
     STOCK ADJUSTMENT MODAL
  ========================= */

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

    if (!selectedAddOn) return "Product not found.";

    const stock = toNumber(selectedAddOn.stocks);
    if (q > stock) return `Not enough stock. Available: ${stock}`;

    const { unit, source } = getUnitForType(selectedAddOn, expenseType);
    if (unit <= 0 || source === "none") return "Set price (and/or expenses_cost) first.";

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

    setSavingExpense(true);
    try {
      // ✅ IMPORTANT: Use RPC so we never update generated columns directly.
      const { error } = await supabase.rpc("record_addon_adjustment", {
        p_add_on_id: selectedAddOn.id,
        p_full_name: fullName.trim(),
        p_quantity: q,
        p_expense_type: expenseType,
        p_description: description.trim(),
      });

      if (error) {
        // eslint-disable-next-line no-console
        console.error("record_addon_adjustment error:", error);
        setToastMessage(error.message);
        setShowToast(true);
        return;
      }

      setToastMessage("Stock adjustment recorded.");
      setShowToast(true);

      setIsExpenseOpen(false);
      await fetchAddOns();
    } finally {
      setSavingExpense(false);
    }
  };

  /* =========================
     CASH OUTS
  ========================= */

  const openCashOutModal = (): void => {
    setCashOutType("");
    setCashOutDesc("");
    setCashOutAmount("");
    setCashOutMethod("cash");
    setIsCashOutOpen(true);
  };

  const closeCashOutModal = (): void => {
    if (savingCashOut) return;
    setIsCashOutOpen(false);
  };

  const validateCashOut = (): string | null => {
    const t = cashOutType.trim();
    if (!t) return "Type is required.";

    const amt = clampMoney(cashOutAmount, -1);
    if (amt < 0) return "Amount must be 0 or higher.";
    if (amt === 0) return "Amount must be greater than 0.";

    return null;
  };

  const submitCashOut = async (): Promise<void> => {
    const err = validateCashOut();
    if (err) {
      setToastMessage(err);
      setShowToast(true);
      return;
    }

    const uid = await getAuthedUserId();
    if (!uid) {
      setToastMessage("Walang Supabase session. Mag-login ulit (Supabase Auth).");
      setShowToast(true);
      return;
    }

    const payload: CashOutInsert = {
      type: cashOutType.trim(),
      description: cashOutDesc.trim() ? cashOutDesc.trim() : null,
      amount: clampMoney(cashOutAmount, 0),
      payment_method: cashOutMethod,
    };

    setSavingCashOut(true);
    try {
      const { error } = await supabase.from("cash_outs").insert(payload);
      if (error) {
        // eslint-disable-next-line no-console
        console.error("cash_outs insert error:", error);
        setToastMessage(error.message);
        setShowToast(true);
        return;
      }

      setToastMessage("Cash out saved.");
      setShowToast(true);

      setIsCashOutOpen(false);
      setCashOutType("");
      setCashOutDesc("");
      setCashOutAmount("");
      setCashOutMethod("cash");
    } finally {
      setSavingCashOut(false);
    }
  };

  const unitInfo = useMemo(() => getUnitForType(selectedAddOn, expenseType), [selectedAddOn?.id, expenseType]);
  const sortLabel = `${sortKey === "category" ? "category" : "stocks"} (${sortOrder})`;

  return (
    <IonPage className="pil-page">
      <IonHeader className="pil-header">
        <IonToolbar className="pil-toolbar">
          <IonTitle className="pil-title">Product Item Lists</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pil-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {/* TOP ACTIONS */}
        <div className="pil-actions">
          <IonButton className="pil-btn pil-btn--primary" onClick={openExpenseModal}>
            <IonIcon slot="start" icon={addCircleOutline} />
            Stock Adjustment
          </IonButton>

          <IonButton className="pil-btn pil-btn--primary" onClick={openCashOutModal}>
            <IonIcon slot="start" icon={cashOutline} />
            Add Cash Outs
          </IonButton>

          <IonItem lines="none" className="pil-sort-item">
            <IonLabel className="pil-sort-label">Sort</IonLabel>
            <IonSelect
              className="pil-sort-select"
              value={sortKey}
              onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) => setSortKey(String(e.detail.value) as SortKey)}
            >
              <IonSelectOption value="category">Category</IonSelectOption>
              <IonSelectOption value="stocks">Stocks</IonSelectOption>
            </IonSelect>
          </IonItem>

          <IonButton className="pil-btn pil-btn--ghost" fill="clear" onClick={toggleSortOrder}>
            <IonIcon slot="start" icon={swapVerticalOutline} />
            <span className="pil-sort-order">{sortOrder === "asc" ? "Asc" : "Desc"}</span>
            <IonIcon icon={sortOrder === "asc" ? arrowUp : arrowDown} />
          </IonButton>

          {/* SEARCH */}
          <div className="pil-search">
            <IonItem lines="none" className="pil-search-item">
              <IonIcon className="pil-search-ico" icon={searchOutline} />
              <IonInput
                className="pil-search-input"
                value={search}
                placeholder="Search name, category, or size..."
                clearInput
                onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => setSearch(String(e.detail.value ?? ""))}
              />
            </IonItem>

            {search.trim() && (
              <div className="pil-search-hint">
                Showing <b>{filteredAddOns.length}</b> result(s)
              </div>
            )}
          </div>
        </div>

        <div className="pil-card">
          <div className="pil-card-head">
            <div>
              <div className="pil-card-title">Products</div>
              <div className="pil-card-sub">
                Sorted by <b>{sortLabel}</b>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="pil-loading">
              <IonSpinner />
              <IonLabel>Loading products...</IonLabel>
            </div>
          ) : filteredAddOns.length === 0 ? (
            <div className="pil-empty">
              <IonLabel>No products found.</IonLabel>
            </div>
          ) : (
            <div className="pil-table-wrap">
              <IonGrid className="pil-grid">
                <IonRow className="pil-row pil-row--head">
                  <IonCol className="pil-col pil-col--img">Image</IonCol>
                  <IonCol className="pil-col pil-col--strong">Name</IonCol>
                  <IonCol className="pil-col">Category</IonCol>
                  <IonCol className="pil-col">Size</IonCol>
                  <IonCol className="pil-col">Price</IonCol>
                  <IonCol className="pil-col">Restocked</IonCol>
                  <IonCol className="pil-col">Sold</IonCol>
                  <IonCol className="pil-col">Expired</IonCol>
                  <IonCol className="pil-col">Inventory Loss</IonCol>
                  <IonCol className="pil-col">Bilin</IonCol>
                  <IonCol className="pil-col">Stocks</IonCol>
                  <IonCol className="pil-col">Expenses (qty)</IonCol>
                  <IonCol className="pil-col">Unit Cost</IonCol>
                  <IonCol className="pil-col">Overall</IonCol>
                  <IonCol className="pil-col">Expected</IonCol>
                </IonRow>

                {filteredAddOns.map((a) => (
                  <IonRow className="pil-row" key={a.id}>
                    <IonCol className="pil-col pil-col--img">
                      {a.image_url ? <IonImg className="pil-img" src={a.image_url} alt={a.name} /> : <span className="pil-muted">No image</span>}
                    </IonCol>

                    <IonCol className="pil-col pil-col--strong">{a.name}</IonCol>
                    <IonCol className="pil-col">{a.category}</IonCol>
                    <IonCol className="pil-col">{normSize(a.size) ?? "—"}</IonCol>
                    <IonCol className="pil-col">{money2(toNumber(a.price))}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.restocked)}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.sold)}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.expired)}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.inventory_loss)}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.bilin)}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.stocks)}</IonCol>
                    <IonCol className="pil-col">{toNumber(a.expenses)}</IonCol>
                    <IonCol className="pil-col">{money2(toNumber(a.expenses_cost))}</IonCol>
                    <IonCol className="pil-col">{money2(toNumber(a.overall_sales))}</IonCol>
                    <IonCol className="pil-col">{money2(toNumber(a.expected_sales))}</IonCol>
                  </IonRow>
                ))}
              </IonGrid>
            </div>
          )}
        </div>

        {/* STOCK ADJUSTMENT MODAL */}
        <IonModal isOpen={isExpenseOpen} onDidDismiss={closeExpenseModal} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">STOCK ADJUSTMENT</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={closeExpenseModal} disabled={savingExpense}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              <IonList className="pil-form">
                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Full Name
                  </IonLabel>
                  <IonInput
                    className="pil-input"
                    value={fullName}
                    placeholder="Enter staff full name"
                    onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => setFullName(String(e.detail.value ?? ""))}
                  />
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Product
                  </IonLabel>
                  <IonSelect
                    className="pil-select"
                    value={selectedAddOnId}
                    placeholder="Select product"
                    onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) => setSelectedAddOnId(String(e.detail.value ?? ""))}
                  >
                    {addOns.map((a) => (
                      <IonSelectOption key={a.id} value={a.id}>
                        {a.category} — {a.name}
                        {normSize(a.size) ? ` (${normSize(a.size)})` : ""} (Stock: {toNumber(a.stocks)})
                      </IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Type
                  </IonLabel>
                  <IonSelect
                    className="pil-select"
                    value={expenseType}
                    onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) => setExpenseType(String(e.detail.value) as ExpenseType)}
                  >
                    <IonSelectOption value="expired">Expired / Damaged</IonSelectOption>
                    <IonSelectOption value="inventory_loss">Inventory Loss</IonSelectOption>
                    <IonSelectOption value="bilin">Bilin (Utang / Bought)</IonSelectOption>
                  </IonSelect>
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Quantity
                  </IonLabel>
                  <IonInput
                    className="pil-input"
                    inputMode="numeric"
                    value={qty}
                    placeholder="1"
                    onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => setQty(String(e.detail.value ?? ""))}
                  />
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Amount (auto)
                  </IonLabel>
                  <IonInput className="pil-input" inputMode="decimal" value={expenseAmount} readonly />
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Description / Reason
                  </IonLabel>
                  <IonTextarea
                    className="pil-textarea"
                    value={description}
                    placeholder="Example: expired date reached / damaged packaging / inventory loss / utang product"
                    autoGrow
                    onIonInput={(e: IonTextareaCustomEvent<TextareaInputEventDetail>) => setDescription(String(e.detail.value ?? ""))}
                  />
                </IonItem>
              </IonList>

              {selectedAddOn && (
                <div className="pil-summary">
                  <div className="pil-summary-title">Selected Product</div>

                  <div className="pil-summary-row">
                    <span>Name</span>
                    <b>{selectedAddOn.name}</b>
                  </div>

                  <div className="pil-summary-row">
                    <span>Category</span>
                    <b>{selectedAddOn.category}</b>
                  </div>

                  <div className="pil-summary-row">
                    <span>Size</span>
                    <b>{normSize(selectedAddOn.size) ?? "—"}</b>
                  </div>

                  <div className="pil-summary-row">
                    <span>Current Stock</span>
                    <b>{toNumber(selectedAddOn.stocks)}</b>
                  </div>

                  <div className="pil-summary-note">
                    Unit Source:{" "}
                    <b>
                      {expenseType === "bilin" || expenseType === "inventory_loss"
                        ? "price"
                        : unitInfo.source === "cost"
                          ? "expenses_cost"
                          : unitInfo.source === "price"
                            ? "price (fallback)"
                            : "none"}
                    </b>
                  </div>

                  <div className="pil-summary-row">
                    <span>Unit Used</span>
                    <b>{money2(unitInfo.unit)}</b>
                  </div>

                  <div className="pil-summary-row">
                    <span>Total</span>
                    <b>{money2(computeAmount(selectedAddOn, expenseType, qty))}</b>
                  </div>

                  {expenseType === "expired" && unitInfo.source === "price" && (
                    <div className="pil-summary-warn">
                      Note: expenses_cost is 0, so we used price as fallback. Set expenses_cost to match your real unit cost.
                    </div>
                  )}

                  {(expenseType === "bilin" || expenseType === "inventory_loss") && (
                    <div className="pil-summary-warn">
                      Note: This type affects <b>Overall</b> (handled by DB: overall_sales includes sold + bilin + inventory_loss).
                    </div>
                  )}
                </div>
              )}

              <div className="pil-modal-actions">
                <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={submitExpense} disabled={savingExpense}>
                  {savingExpense ? "Saving..." : "Save Adjustment"}
                </IonButton>

                <IonButton className="pil-btn" expand="block" fill="outline" onClick={closeExpenseModal} disabled={savingExpense}>
                  Cancel
                </IonButton>
              </div>
            </div>
          </IonContent>
        </IonModal>

        {/* CASH OUTS MODAL */}
        <IonModal isOpen={isCashOutOpen} onDidDismiss={closeCashOutModal} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">Add Cash Outs</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={closeCashOutModal} disabled={savingCashOut}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              <IonList className="pil-form">
                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Type
                  </IonLabel>
                  <IonInput
                    className="pil-input"
                    value={cashOutType}
                    placeholder="Example: money"
                    onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => setCashOutType(String(e.detail.value ?? ""))}
                  />
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Description
                  </IonLabel>
                  <IonTextarea
                    className="pil-textarea"
                    value={cashOutDesc}
                    placeholder="Example: allowance"
                    autoGrow
                    onIonInput={(e: IonTextareaCustomEvent<TextareaInputEventDetail>) => setCashOutDesc(String(e.detail.value ?? ""))}
                  />
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Payment (Cash / GCash)
                  </IonLabel>
                  <IonSelect
                    className="pil-select"
                    value={cashOutMethod}
                    onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) => setCashOutMethod(String(e.detail.value) as CashOutMethod)}
                  >
                    <IonSelectOption value="cash">Cash</IonSelectOption>
                    <IonSelectOption value="gcash">GCash</IonSelectOption>
                  </IonSelect>
                </IonItem>

                <IonItem className="pil-item">
                  <IonLabel position="stacked" className="pil-label">
                    Amount
                  </IonLabel>
                  <IonInput
                    className="pil-input"
                    inputMode="decimal"
                    value={cashOutAmount}
                    placeholder="0.00"
                    onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) => setCashOutAmount(String(e.detail.value ?? ""))}
                  />
                  <div className="pil-hint" style={{ padding: "10px 14px 0" }}>
                    Preview: <b>{money2(clampMoney(cashOutAmount, 0))}</b>
                  </div>
                </IonItem>
              </IonList>

              <div className="pil-modal-actions">
                <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={submitCashOut} disabled={savingCashOut}>
                  {savingCashOut ? "Saving..." : "Save Cash Outs"}
                </IonButton>

                <IonButton className="pil-btn" expand="block" fill="outline" onClick={closeCashOutModal} disabled={savingCashOut}>
                  Cancel
                </IonButton>
              </div>
            </div>
          </IonContent>
        </IonModal>

        <IonToast isOpen={showToast} message={toastMessage} duration={3500} onDidDismiss={() => setShowToast(false)} />
      </IonContent>
    </IonPage>
  );
};

export default Product_Item_Lists;
