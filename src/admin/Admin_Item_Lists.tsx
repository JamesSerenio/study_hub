// src/pages/Admin_Item_Lists.tsx
// ✅ Add Stocks button + Restock history via RPC
// ✅ Restocked is NOT edited in Edit modal anymore
// ✅ No "any"
// ✅ SAME UI/CLASSNAMES as Product_Item_Lists (PIL theme)
// ✅ Search bar (name/category)
// ✅ Sort by Category OR Stock (asc/desc)
// ✅ Actions kept (Add Stocks / Edit / Delete) — only wrapped with classnames

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
  IonAlert,
  IonModal,
  IonInput,
  IonItem,
  IonImg,
  IonText,
  IonButtons,
  IonSpinner,
} from "@ionic/react";
import {
  trash,
  create,
  arrowUp,
  arrowDown,
  addCircle,
  addCircleOutline,
  swapVerticalOutline,
  searchOutline,
  closeOutline,
} from "ionicons/icons";
import { supabase } from "../utils/supabaseClient";
import type {
  IonInputCustomEvent,
  InputInputEventDetail,
  IonSelectCustomEvent,
  SelectChangeEventDetail,
} from "@ionic/core";
import { IonSelect, IonSelectOption } from "@ionic/react";

type SortKey = "category" | "stocks";

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

const BUCKET = "add-ons";

const money2 = (n: number): string => `₱${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;

const Admin_Item_Lists: React.FC = () => {
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [showToast, setShowToast] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>("");

  // ✅ sort controls (same as PIL)
  const [sortKey, setSortKey] = useState<SortKey>("category");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // ✅ search (same as PIL)
  const [search, setSearch] = useState<string>("");

  const [showDeleteAlert, setShowDeleteAlert] = useState<boolean>(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [showEditModal, setShowEditModal] = useState<boolean>(false);
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);

  const [newImageFile, setNewImageFile] = useState<File | null>(null);

  // ✅ Restock modal state
  const [showRestockModal, setShowRestockModal] = useState<boolean>(false);
  const [restockingAddOn, setRestockingAddOn] = useState<AddOn | null>(null);
  const [restockQty, setRestockQty] = useState<string>("");
  const [restockNote, setRestockNote] = useState<string>("");

  const fetchAddOns = async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("add_ons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAddOns((data as AddOn[]) || []);
    } catch (error: unknown) {
      console.error("Error fetching add-ons:", error);
      setToastMessage("Error loading add-ons. Please try again.");
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

      const aStock = Number.isFinite(a.stocks) ? a.stocks : 0;
      const bStock = Number.isFinite(b.stocks) ? b.stocks : 0;
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
      return name.includes(q) || cat.includes(q);
    });
  }, [sortedAddOns, search]);

  const toggleSortOrder = (): void => {
    setSortOrder((p) => (p === "asc" ? "desc" : "asc"));
  };

  const handleEdit = (id: string): void => {
    const addOnToEdit = addOns.find((a) => a.id === id);
    if (!addOnToEdit) return;
    setEditingAddOn({ ...addOnToEdit });
    setNewImageFile(null);
    setShowEditModal(true);
  };

  // ✅ open restock modal
  const openRestock = (id: string): void => {
    const a = addOns.find((x) => x.id === id);
    if (!a) return;
    setRestockingAddOn(a);
    setRestockQty("");
    setRestockNote("");
    setShowRestockModal(true);
  };

  // ✅ Extract bucket path from public URL
  const getStoragePathFromPublicUrl = (publicUrl: string, bucket: string): string | null => {
    try {
      const marker = `/storage/v1/object/public/${bucket}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return null;

      const pathWithMaybeQuery = publicUrl.substring(idx + marker.length);
      const path = pathWithMaybeQuery.split("?")[0];
      return decodeURIComponent(path);
    } catch {
      return null;
    }
  };

  const uploadNewImage = async (): Promise<{ publicUrl: string; newPath: string }> => {
    if (!newImageFile) throw new Error("No image selected");

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) throw userErr;
    if (!userRes?.user) throw new Error("Not logged in");

    const userId: string = userRes.user.id;

    const extRaw: string | undefined = newImageFile.name.split(".").pop();
    const fileExt: string = (extRaw ? extRaw.toLowerCase() : "jpg").trim();
    const fileName: string = `${Date.now()}.${fileExt}`;
    const newPath: string = `${userId}/${fileName}`;

    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(newPath, newImageFile, {
      contentType: newImageFile.type,
      upsert: false,
    });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
    return { publicUrl: urlData.publicUrl, newPath };
  };

  const deleteOldImageIfAny = async (oldImageUrl: string | null): Promise<void> => {
    if (!oldImageUrl) return;

    const oldPath = getStoragePathFromPublicUrl(oldImageUrl, BUCKET);
    if (!oldPath) return;

    const { error } = await supabase.storage.from(BUCKET).remove([oldPath]);
    if (error) console.warn("Failed to delete old image:", error.message);
  };

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingAddOn) return;

    if (!editingAddOn.name.trim()) return void (setToastMessage("Name is required."), setShowToast(true));
    if (!editingAddOn.category.trim())
      return void (setToastMessage("Category is required."), setShowToast(true));
    if (Number.isNaN(editingAddOn.price) || editingAddOn.price < 0)
      return void (setToastMessage("Price must be a valid positive number."), setShowToast(true));
    if (Number.isNaN(editingAddOn.sold) || editingAddOn.sold < 0)
      return void (setToastMessage("Sold must be a valid non-negative number."), setShowToast(true));
    if (Number.isNaN(editingAddOn.expenses) || editingAddOn.expenses < 0)
      return void (setToastMessage("Expenses must be a valid non-negative number."), setShowToast(true));

    const oldImageUrl: string | null = editingAddOn.image_url ?? null;

    try {
      let finalImageUrl: string | null = oldImageUrl;

      if (newImageFile) {
        const uploaded = await uploadNewImage();
        finalImageUrl = uploaded.publicUrl;
      }

      // ✅ restocked REMOVED from edit update
      const { error } = await supabase
        .from("add_ons")
        .update({
          category: editingAddOn.category,
          name: editingAddOn.name,
          price: editingAddOn.price,
          sold: editingAddOn.sold,
          expenses: editingAddOn.expenses,
          image_url: finalImageUrl,
        })
        .eq("id", editingAddOn.id);

      if (error) throw error;

      if (newImageFile && finalImageUrl && finalImageUrl !== oldImageUrl) {
        await deleteOldImageIfAny(oldImageUrl);
      }

      const updated: AddOn = { ...editingAddOn, image_url: finalImageUrl };
      setAddOns((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));

      setToastMessage("Add-on updated successfully.");
      setShowToast(true);

      setShowEditModal(false);
      setEditingAddOn(null);
      setNewImageFile(null);
    } catch (error: unknown) {
      console.error("Error updating add-on:", error);
      setToastMessage(`Error updating add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }
  };

  // ✅ RESTOCK SUBMIT (RPC)
  const submitRestock = async (): Promise<void> => {
    if (!restockingAddOn) return;

    const qty = parseInt(restockQty.trim(), 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setToastMessage("Restock quantity must be a positive number.");
      setShowToast(true);
      return;
    }

    try {
      const { error } = await supabase.rpc("restock_add_on", {
        p_add_on_id: restockingAddOn.id,
        p_qty: qty,
        p_note: restockNote.trim() || null,
      });

      if (error) throw error;

      setToastMessage("Stocks added successfully.");
      setShowToast(true);

      setShowRestockModal(false);
      setRestockingAddOn(null);
      setRestockQty("");
      setRestockNote("");

      void fetchAddOns();
    } catch (error: unknown) {
      console.error("Error restocking:", error);
      setToastMessage(`Error restocking: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }
  };

  const handleDelete = (id: string): void => {
    setDeleteId(id);
    setShowDeleteAlert(true);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteId) {
      setShowDeleteAlert(false);
      return;
    }

    try {
      const { error } = await supabase.from("add_ons").delete().eq("id", deleteId);
      if (error) throw error;

      setAddOns((prev) => prev.filter((a) => a.id !== deleteId));
      setToastMessage("Add-on deleted successfully.");
      setShowToast(true);
    } catch (error: unknown) {
      console.error("Error deleting add-on:", error);
      setToastMessage(`Error deleting add-on: ${error instanceof Error ? error.message : "Please try again."}`);
      setShowToast(true);
    }

    setShowDeleteAlert(false);
    setDeleteId(null);
  };

  const sortLabel = `${sortKey === "category" ? "category" : "stocks"} (${sortOrder})`;

  return (
    <IonPage className="pil-page">
      <IonHeader className="pil-header">
        <IonToolbar className="pil-toolbar">
          <IonTitle className="pil-title">Admin Item Lists</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pil-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {/* TOP ACTIONS (same layout/classnames as PIL) */}
        <div className="pil-actions">
          {/* optional: keep a header action button look consistent */}
          <IonButton className="pil-btn pil-btn--primary" fill="solid" onClick={() => void fetchAddOns()}>
            <IonIcon slot="start" icon={addCircleOutline} />
            Refresh
          </IonButton>

          <IonItem lines="none" className="pil-sort-item">
            <IonLabel className="pil-sort-label">Sort</IonLabel>
            <IonSelect
              className="pil-sort-select"
              value={sortKey}
              onIonChange={(e: IonSelectCustomEvent<SelectChangeEventDetail>) =>
                setSortKey(String(e.detail.value) as SortKey)
              }
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

          {/* ✅ SEARCH BAR (same classnames) */}
          <div className="pil-search">
            <IonItem lines="none" className="pil-search-item">
              <IonIcon className="pil-search-ico" icon={searchOutline} />
              <IonInput
                className="pil-search-input"
                value={search}
                placeholder="Search name or category..."
                clearInput
                onIonInput={(e: IonInputCustomEvent<InputInputEventDetail>) =>
                  setSearch(String(e.detail.value ?? ""))
                }
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
              <div className="pil-card-title">Add-ons</div>
              <div className="pil-card-sub">
                Sorted by <b>{sortLabel}</b>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="pil-loading">
              <IonSpinner />
              <IonLabel>Loading add-ons...</IonLabel>
            </div>
          ) : filteredAddOns.length === 0 ? (
            <div className="pil-empty">
              <IonLabel>No add-ons found.</IonLabel>
            </div>
          ) : (
            <div className="pil-table-wrap">
              <IonGrid className="pil-grid">
                <IonRow className="pil-row pil-row--head">
                  <IonCol className="pil-col pil-col--img">Image</IonCol>
                  <IonCol className="pil-col pil-col--strong">Name</IonCol>
                  <IonCol className="pil-col">Category</IonCol>
                  <IonCol className="pil-col">Price</IonCol>
                  <IonCol className="pil-col">Restocked</IonCol>
                  <IonCol className="pil-col">Sold</IonCol>
                  <IonCol className="pil-col">Stocks</IonCol>
                  <IonCol className="pil-col">Expenses</IonCol>
                  <IonCol className="pil-col">Overall</IonCol>
                  <IonCol className="pil-col">Expected</IonCol>
                  <IonCol className="pil-col">Actions</IonCol>
                </IonRow>

                {filteredAddOns.map((addOn) => (
                  <IonRow className="pil-row" key={addOn.id}>
                    <IonCol className="pil-col pil-col--img">
                      {addOn.image_url ? (
                        <IonImg className="pil-img" src={addOn.image_url} alt={addOn.name} />
                      ) : (
                        <span className="pil-muted">No image</span>
                      )}
                    </IonCol>

                    <IonCol className="pil-col pil-col--strong">{addOn.name}</IonCol>
                    <IonCol className="pil-col">{addOn.category}</IonCol>
                    <IonCol className="pil-col">{money2(Number(addOn.price))}</IonCol>
                    <IonCol className="pil-col">{addOn.restocked}</IonCol>
                    <IonCol className="pil-col">{addOn.sold}</IonCol>
                    <IonCol className="pil-col">{addOn.stocks}</IonCol>
                    <IonCol className="pil-col">{addOn.expenses}</IonCol>
                    <IonCol className="pil-col">{money2(Number(addOn.overall_sales))}</IonCol>
                    <IonCol className="pil-col">{money2(Number(addOn.expected_sales))}</IonCol>

                    {/* ✅ ACTIONS (not changing logic, only add classnames for style) */}
                    <IonCol className="pil-col">
                      <div className="pil-actions-cell">
                        <IonButton
                          className="pil-act-btn pil-act-btn--add"
                          fill="clear"
                          onClick={() => openRestock(addOn.id)}
                        >
                          <IonIcon icon={addCircle} />
                        </IonButton>

                        <IonButton
                          className="pil-act-btn pil-act-btn--edit"
                          fill="clear"
                          onClick={() => handleEdit(addOn.id)}
                        >
                          <IonIcon icon={create} />
                        </IonButton>

                        <IonButton
                          className="pil-act-btn pil-act-btn--del"
                          fill="clear"
                          color="danger"
                          onClick={() => handleDelete(addOn.id)}
                        >
                          <IonIcon icon={trash} />
                        </IonButton>
                      </div>
                    </IonCol>
                  </IonRow>
                ))}
              </IonGrid>
            </div>
          )}
        </div>

        <IonToast
          isOpen={showToast}
          message={toastMessage}
          duration={3000}
          onDidDismiss={() => setShowToast(false)}
        />

        <IonAlert
          isOpen={showDeleteAlert}
          onDidDismiss={() => setShowDeleteAlert(false)}
          header="Confirm Delete"
          message="Are you sure you want to delete this add-on?"
          buttons={[
            { text: "Cancel", role: "cancel", handler: () => setShowDeleteAlert(false) },
            { text: "Delete", role: "destructive", handler: () => void confirmDelete() },
          ]}
        />

        {/* ✅ RESTOCK MODAL (use same pil-modal classnames) */}
        <IonModal isOpen={showRestockModal} onDidDismiss={() => setShowRestockModal(false)} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">Add Stocks</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={() => setShowRestockModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              {restockingAddOn && (
                <>
                  <IonText>
                    <h2 style={{ marginTop: 0, marginBottom: 8 }}>{restockingAddOn.name}</h2>
                  </IonText>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Quantity to add *
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      inputMode="numeric"
                      value={restockQty}
                      placeholder="e.g. 10"
                      onIonChange={(e) => setRestockQty((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Note (optional)
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={restockNote}
                      placeholder="e.g. supplier restock / new batch"
                      onIonChange={(e) => setRestockNote((e.detail.value ?? "").toString())}
                    />
                  </IonItem>

                  <div className="pil-modal-actions">
                    <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={() => void submitRestock()}>
                      Confirm Restock
                    </IonButton>

                    <IonButton
                      className="pil-btn"
                      expand="block"
                      fill="outline"
                      onClick={() => {
                        setShowRestockModal(false);
                        setRestockingAddOn(null);
                        setRestockQty("");
                        setRestockNote("");
                      }}
                    >
                      Cancel
                    </IonButton>
                  </div>
                </>
              )}
            </div>
          </IonContent>
        </IonModal>

        {/* EDIT MODAL (use same pil-modal classnames) */}
        <IonModal isOpen={showEditModal} onDidDismiss={() => setShowEditModal(false)} className="pil-modal">
          <IonHeader className="pil-modal-header">
            <IonToolbar className="pil-modal-toolbar">
              <IonTitle className="pil-modal-title">Edit Add-On</IonTitle>
              <IonButtons slot="end">
                <IonButton className="pil-btn" onClick={() => setShowEditModal(false)}>
                  <IonIcon icon={closeOutline} />
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>

          <IonContent className="pil-modal-content">
            <div className="pil-modal-card">
              {editingAddOn && (
                <>
                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Name
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={editingAddOn.name}
                      onIonChange={(e) =>
                        setEditingAddOn({
                          ...editingAddOn,
                          name: (e.detail.value ?? "").toString(),
                        })
                      }
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Category
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      value={editingAddOn.category}
                      onIonChange={(e) =>
                        setEditingAddOn({
                          ...editingAddOn,
                          category: (e.detail.value ?? "").toString(),
                        })
                      }
                    />
                  </IonItem>

                  {/* ✅ REPLACE IMAGE */}
                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Replace Image (optional)
                    </IonLabel>
                    <input
                      className="pil-file"
                      type="file"
                      accept="image/*"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const files: FileList | null = e.target.files;
                        setNewImageFile(files && files.length > 0 ? files[0] : null);
                      }}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Current Image
                    </IonLabel>
                    {editingAddOn.image_url ? (
                      <IonImg className="pil-img pil-img--big" src={editingAddOn.image_url} alt="current" />
                    ) : (
                      <span className="pil-muted">No image</span>
                    )}
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Price
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      value={editingAddOn.price}
                      onIonChange={(e) => {
                        const v = parseFloat((e.detail.value ?? "0").toString());
                        setEditingAddOn({ ...editingAddOn, price: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </IonItem>

                  {/* ✅ Restocked removed from edit */}

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Sold
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      value={editingAddOn.sold}
                      onIonChange={(e) => {
                        const v = parseInt((e.detail.value ?? "0").toString(), 10);
                        setEditingAddOn({ ...editingAddOn, sold: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </IonItem>

                  <IonItem className="pil-item">
                    <IonLabel position="stacked" className="pil-label">
                      Expenses
                    </IonLabel>
                    <IonInput
                      className="pil-input"
                      type="number"
                      value={editingAddOn.expenses}
                      onIonChange={(e) => {
                        const v = parseFloat((e.detail.value ?? "0").toString());
                        setEditingAddOn({ ...editingAddOn, expenses: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                  </IonItem>

                  <div className="pil-modal-actions">
                    <IonButton className="pil-btn pil-btn--primary" expand="block" onClick={() => void handleSaveEdit()}>
                      Save Changes
                    </IonButton>

                    <IonButton
                      className="pil-btn"
                      expand="block"
                      fill="outline"
                      onClick={() => {
                        setShowEditModal(false);
                        setEditingAddOn(null);
                        setNewImageFile(null);
                      }}
                    >
                      Cancel
                    </IonButton>
                  </div>
                </>
              )}
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default Admin_Item_Lists;
