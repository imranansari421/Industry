import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDocs, query, where, doc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { safeJsonStringify } from '../utils/firestore-errors';
import { Plus, Download, Eye, X, Upload, FileText, Search, Loader2, Trash2, Edit, Camera } from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';

interface Part {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  rate: number;
  stock: number;
  totalValue: number;
  location: string;
  whetherUse?: string;
  remarks?: string;
  machineName?: string;
  imageUrl?: string;
}

interface Transaction {
  id: string;
  partId: string;
  type: 'received' | 'issued' | 'old_stock';
  qty: number;
  date: string;
  receiverName?: string;
  remarks?: string;
  details?: string;
  runningBalance?: number;
}

import { findEmployeeForUser } from '../utils/employee';

export default function Catalog() {
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessType = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return !isEmployee || userAccessType === 'full' || userAccessType === 'admin-light';
  });

  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [customMachines, setCustomMachines] = useState<string[]>([]);
  const [isCustomMachineNew, setIsCustomMachineNew] = useState(false);
  const [customMachineNewInput, setCustomMachineNewInput] = useState('');
  const [isCustomMachineEdit, setIsCustomMachineEdit] = useState(false);
  const [customMachineEditInput, setCustomMachineEditInput] = useState('');

  useEffect(() => {
    const checkAccess = async () => {
      if (!auth.currentUser) return;
      const isEmployee = auth.currentUser.email?.endsWith('@employee.billedapp.com');
      if (isEmployee) {
        const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
        if (emp) {
          const isFull = emp.accessType === 'full' || emp.accessType === 'admin-light';
          localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
          setIsAdmin(isFull);
          const mName = emp.machineName || '';
          setUserMachine(mName);
          localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);
        }
      }
    };
    checkAccess();
  }, []);

  const [parts, setParts] = useState<Part[]>([]);
  const [partsWithTransactions, setPartsWithTransactions] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partToDelete, setPartToDelete] = useState<string | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
  }

  const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', safeJsonStringify(errInfo));
    throw new Error(safeJsonStringify(errInfo));
  };

  const [newPart, setNewPart] = useState({
    plNo: '',
    description: '',
    partNo: '',
    rate: 0,
    stock: 0,
    location: '',
    whetherUse: 'CS',
    remarks: '',
    machineName: '',
    imageUrl: '',
  });

  const [editPartData, setEditPartData] = useState<Part>({
    id: '',
    plNo: '',
    description: '',
    partNo: '',
    rate: 0,
    stock: 0,
    location: '',
    totalValue: 0,
    whetherUse: 'CS',
    remarks: '',
    machineName: '',
    imageUrl: '',
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only JPG, JPEG, and PNG formats are allowed.');
      return;
    }

    if (file.size > 300 * 1024) {
      toast.error('Image size must be less than 300kb.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      if (isEdit) {
        setEditPartData(prev => ({ ...prev, imageUrl: base64 }));
      } else {
        setNewPart(prev => ({ ...prev, imageUrl: base64 }));
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    console.log('Current User:', auth.currentUser?.email);
    fetchParts();
  }, []);

  const fetchParts = async () => {
    setLoading(true);
    try {
      // Fetch all employees to get companies mapping
      const empSnapshot = await getDocs(collection(db, 'employees'));
      const empList = empSnapshot.docs.map(doc => doc.data());
      setEmployeeList(empList);
      const uniqueCos = Array.from(new Set(empList.map(e => e.companyName).filter((c): c is string => !!c))) as string[];
      setCompaniesList(uniqueCos);

      const querySnapshot = await getDocs(collection(db, 'parts'));
      const partList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Part));
      
      // Extract custom machines from parts list
      const uniqueMachines = Array.from(new Set(partList.map(p => p.machineName).filter((m): m is string => !!m)));
      const standardMachines = ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setParts(partList);

      // Fetch all transactions to see which parts have transactions
      const txSnapshot = await getDocs(collection(db, 'transactions'));
      const partIdsWithTx = new Set<string>();
      txSnapshot.docs.forEach(txDoc => {
        const txData = txDoc.data();
        if (txData.partId) {
          partIdsWithTx.add(txData.partId);
        }
      });
      setPartsWithTransactions(partIdsWithTx);
    } catch (error) {
      console.error('Error fetching parts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddPart = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Check for duplicates
      let plSnapEmpty = true;
      let partNoSnapEmpty = true;

      const promises = [];
      if (newPart.plNo && newPart.plNo.trim() !== "") {
        const plQuery = query(collection(db, 'parts'), where('plNo', '==', newPart.plNo.trim()));
        promises.push(getDocs(plQuery).then(snap => { plSnapEmpty = snap.empty; }));
      }
      if (newPart.partNo && newPart.partNo.trim() !== "") {
        const partNoQuery = query(collection(db, 'parts'), where('partNo', '==', newPart.partNo.trim()));
        promises.push(getDocs(partNoQuery).then(snap => { partNoSnapEmpty = snap.empty; }));
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      if (!plSnapEmpty || !partNoSnapEmpty) {
        toast.error('Item with this PL No. or Part No. already exists!');
        setSubmitting(false);
        return;
      }

      const totalValue = newPart.rate * newPart.stock;
      const machineToAssign = isEmployee ? userMachine : newPart.machineName;
      const partRef = await addDoc(collection(db, 'parts'), {
        plNo: newPart.plNo || '',
        description: newPart.description,
        partNo: newPart.partNo,
        rate: newPart.rate,
        stock: newPart.stock,
        location: newPart.location,
        whetherUse: newPart.whetherUse,
        remarks: newPart.remarks,
        totalValue,
        machineName: machineToAssign || '',
        imageUrl: newPart.imageUrl || '',
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'parts'));

      // Add initial stock / remarks to history
      if (newPart.stock > 0 || newPart.remarks) {
        await addDoc(collection(db, 'transactions'), {
          partId: partRef.id,
          type: 'old_stock',
          qty: newPart.stock,
          date: format(new Date(), 'yyyy-MM-dd'),
          details: 'Initial stock entry',
          remarks: newPart.remarks || '',
        }).catch(err => handleFirestoreError(err, OperationType.CREATE, 'transactions'));
      }

      toast.success('Part added successfully');
      setShowAddModal(false);
      fetchParts();
      setNewPart({
        plNo: '',
        description: '',
        partNo: '',
        rate: 0,
        stock: 0,
        location: '',
        whetherUse: 'CS',
        remarks: '',
        machineName: '',
        imageUrl: '',
      });
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
    } catch (error) {
      console.error('Error adding part:', error);
      toast.error('Failed to add part. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditPart = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const partRef = doc(db, 'parts', editPartData.id);
      const totalValue = editPartData.rate * editPartData.stock;
      const machineToAssign = isEmployee ? userMachine : editPartData.machineName;
      await updateDoc(partRef, {
        plNo: editPartData.plNo || '',
        partNo: editPartData.partNo,
        description: editPartData.description,
        rate: editPartData.rate,
        stock: editPartData.stock,
        location: editPartData.location || '',
        whetherUse: editPartData.whetherUse || 'CS',
        remarks: editPartData.remarks || '',
        totalValue,
        machineName: machineToAssign || '',
        imageUrl: editPartData.imageUrl || '',
      }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `parts/${editPartData.id}`));

      toast.success('Part updated successfully');
      setShowEditModal(false);
      fetchParts();
    } catch (error) {
      console.error('Error editing part:', error);
      toast.error('Failed to update part.');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchHistory = async (partId: string) => {
    try {
      const q = query(collection(db, 'transactions'), where('partId', '==', partId));
      const querySnapshot = await getDocs(q);
      const historyList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      
      // Sort chronologically (oldest first) to compute running balance correctly
      const sortedChronological = [...historyList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      let balance = 0;
      const historyWithBalance = sortedChronological.map(tx => {
        if (tx.type === 'issued') {
          balance -= tx.qty;
        } else {
          balance += tx.qty;
        }
        return {
          ...tx,
          runningBalance: balance,
        };
      });

      // Sort back to newest first for table display
      setHistory(historyWithBalance.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const handleShowHistory = (part: Part) => {
    setSelectedPart(part);
    fetchHistory(part.id);
    setShowHistoryModal(true);
  };

  const handleDeletePart = async () => {
    if (!partToDelete) return;
    
    setSubmitting(true);
    try {
      await deleteDoc(doc(db, 'parts', partToDelete));
      toast.success('Item deleted successfully');
      setShowDeleteModal(false);
      setPartToDelete(null);
      fetchParts();
    } catch (error) {
      console.error('Error deleting part:', error);
      toast.error('Failed to delete item');
    } finally {
      setSubmitting(false);
    }
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredParts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, "Inventory_Report.xlsx");
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text("Inventory Catalog", 14, 15);
    autoTable(doc, {
      head: [['Sr No.', 'PL No.', 'Description', 'Part No.', 'Rate', 'Stock', 'Total Value', 'Location', 'Whether Use']],
      body: filteredParts.map((p, i) => [i + 1, p.plNo, p.description, p.partNo, p.rate, p.stock, p.totalValue, p.location, p.whetherUse || 'CS']),
      startY: 20,
    });
    doc.save("Inventory_Report.pdf");
  };

  const filteredParts = parts.filter(p => {
    const plNo = p.plNo || '';
    const description = p.description || '';
    const partNo = p.partNo || '';
    const search = searchTerm.toLowerCase();
    
    const matchesSearch = plNo.toLowerCase().includes(search) || 
                          description.toLowerCase().includes(search) || 
                          partNo.toLowerCase().includes(search);
                          
    if (!matchesSearch) return false;

    // Apply company filter constraint
    if (!isEmployee && selectedCompany !== 'all') {
      const companyEmployees = employeeList.filter(e => e.companyName === selectedCompany);
      const companyMachines = new Set(companyEmployees.map(e => e.machineName).filter(Boolean));
      if (!p.machineName || !companyMachines.has(p.machineName)) {
        return false;
      }
    }

    // Apply machine filter constraint
    if (isEmployee && isAdmin) {
      if (userMachine) {
        return p.machineName === userMachine;
      }
    }
    if (!isEmployee && selectedMachine !== 'all') {
      return p.machineName === selectedMachine;
    }
    return true;
  });

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-3xl font-black text-primary tracking-tight">Part Catalog</h1>
          {!isEmployee ? (
            <div className="flex items-center gap-2">
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                value={selectedCompany}
                onChange={e => setSelectedCompany(e.target.value)}
              >
                <option value="all">All Companies</option>
                {companiesList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm"
                value={selectedMachine}
                onChange={e => setSelectedMachine(e.target.value)}
              >
                <option value="all">All Machines</option>
                {[...["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"], ...customMachines].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          ) : (
            userMachine && (
              <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs px-2.5 py-1 rounded-full font-bold">
                Machine: {userMachine}
              </span>
            )
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search PL No, Part No..."
              className="pl-10 pr-4 py-2 border border-outline/20 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all w-64"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <Plus size={20} /> New Item
          </button>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-lg font-semibold hover:bg-indigo-50 transition-colors"
          >
            <Download size={20} /> Excel
          </button>
          <button
            onClick={exportToPDF}
            className="flex items-center gap-2 border border-primary text-primary px-4 py-2 rounded-lg font-semibold hover:bg-indigo-50 transition-colors"
          >
            <FileText size={20} /> PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-x-auto">
        <table className="w-full text-left min-w-[1000px]">
          <thead className="bg-surface-container-highest">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Sr No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">PL No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Description</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Part No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Rate</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Stock</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Total Value</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Location</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Whether Use</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            {filteredParts.map((part, index) => (
              <tr key={part.id} className="hover:bg-surface-container-low transition-colors">
                <td className="px-6 py-4 text-xs font-bold">{index + 1}</td>
                <td className="px-6 py-4 text-xs font-mono font-bold text-primary">{part.plNo}</td>
                <td className="px-6 py-4 text-sm">
                  <div className="flex items-center gap-3">
                    {part.imageUrl && (
                      <div className="w-10 h-10 rounded border border-slate-200/60 overflow-hidden flex-shrink-0 bg-slate-50 flex items-center justify-center">
                        <img src={part.imageUrl} alt={part.description} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div>{part.description}</div>
                  </div>
                </td>
                <td className="px-6 py-4 text-xs font-mono">{part.partNo}</td>
                <td className="px-6 py-4 text-sm">₹{(Number.isNaN(part.rate) ? 0 : (part.rate || 0)).toFixed(2)}</td>
                <td className="px-6 py-4 text-sm font-bold">{Number.isNaN(part.stock) ? 0 : (part.stock || 0)}</td>
                 <td className="px-6 py-4 text-sm font-bold text-primary">₹{(Number.isNaN(part.totalValue) ? 0 : (part.totalValue || 0)).toLocaleString()}</td>
                <td className="px-6 py-4 text-sm">{part.location}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={cn(
                    "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm",
                    part.whetherUse === 'CS' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                    part.whetherUse === 'MS' ? "bg-indigo-50 text-indigo-700 border border-indigo-200" :
                    part.whetherUse === 'T&P' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                    "bg-amber-50 text-amber-700 border border-amber-200"
                  )}>
                    {part.whetherUse || 'CS'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleShowHistory(part)}
                      className="p-2 text-secondary hover:text-primary transition-colors"
                      title="View History"
                    >
                      <Eye size={18} />
                    </button>
                    {isAdmin && (
                      <>
                        {(!partsWithTransactions.has(part.id) || !isEmployee) && (
                          <>
                            <button
                              onClick={() => {
                                setEditPartData({
                                  id: part.id,
                                  plNo: part.plNo,
                                  description: part.description,
                                  partNo: part.partNo,
                                  rate: part.rate,
                                  stock: part.stock,
                                  location: part.location || '',
                                  whetherUse: part.whetherUse || 'CS',
                                  remarks: part.remarks || '',
                                  totalValue: part.totalValue,
                                  machineName: part.machineName || '',
                                });
                                const standardMachines = ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
                                const mName = part.machineName || '';
                                if (mName && !standardMachines.includes(mName)) {
                                  setIsCustomMachineEdit(true);
                                  setCustomMachineEditInput(mName);
                                } else {
                                  setIsCustomMachineEdit(false);
                                  setCustomMachineEditInput('');
                                }
                                setShowEditModal(true);
                              }}
                              className="p-2 text-indigo-400 hover:text-indigo-600 transition-colors"
                              title="Edit Item"
                            >
                              <Edit size={18} />
                            </button>
                            <button
                              onClick={() => {
                                setPartToDelete(part.id);
                                setShowDeleteModal(true);
                              }}
                              className="p-2 text-red-400 hover:text-red-600 transition-colors"
                              title="Delete Item"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Part Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Create New Item</h2>
              <button onClick={() => setShowAddModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddPart} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.plNo}
                    onChange={e => setNewPart({ ...newPart, plNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.partNo}
                    onChange={e => setNewPart({ ...newPart, partNo: e.target.value })}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.description}
                    onChange={e => setNewPart({ ...newPart, description: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.rate}
                    onChange={e => setNewPart({ ...newPart, rate: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Initial Stock</label>
                  <input
                    type="number"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.stock}
                    onChange={e => setNewPart({ ...newPart, stock: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                    required
                  />
                </div>
                 <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Location</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newPart.location}
                    onChange={e => setNewPart({ ...newPart, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                    value={newPart.whetherUse}
                    onChange={e => setNewPart({ ...newPart, whetherUse: e.target.value })}
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="MS">MS</option>
                    <option value="T&P">T&P</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {!isEmployee && (
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                      <select
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-700"
                        value={isCustomMachineNew ? 'Other' : newPart.machineName}
                        onChange={(e) => {
                          if (e.target.value === 'Other') {
                            setIsCustomMachineNew(true);
                            setNewPart({ ...newPart, machineName: customMachineNewInput });
                          } else {
                            setIsCustomMachineNew(false);
                            setNewPart({ ...newPart, machineName: e.target.value });
                          }
                        }}
                      >
                        <option value="">None / General</option>
                        {["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        {customMachines.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="Other">Other (Type custom)</option>
                      </select>
                    </div>
                    {isCustomMachineNew && (
                      <div>
                        <label className="block text-xs font-bold uppercase text-secondary mb-1">Type Machine Name</label>
                        <input
                          type="text"
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-semibold text-slate-800"
                          value={customMachineNewInput}
                          onChange={(e) => {
                            setCustomMachineNewInput(e.target.value);
                            setNewPart({ ...newPart, machineName: e.target.value });
                          }}
                          placeholder="e.g. NEW-MACHINE"
                          required
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-2">Item Image (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                    <div className="relative w-24 h-24 rounded bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm group">
                      {newPart.imageUrl ? (
                        <>
                          <img src={newPart.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setNewPart(prev => ({ ...prev, imageUrl: '' }))}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <Camera size={24} />
                          <span className="text-[9px] font-bold uppercase tracking-wider mt-1">No Image</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 w-full">
                      <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-4 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png"
                          onChange={(e) => handleImageUpload(e, false)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <Upload size={18} className="text-indigo-500 mb-1" />
                        <p className="text-xs font-bold text-slate-700">Click or Drag Image Here</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={newPart.remarks}
                    onChange={e => setNewPart({ ...newPart, remarks: e.target.value })}
                    placeholder="Enter remarks for this item..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Save Item
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      {/* Edit Part Modal */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Edit Item</h2>
              <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditPart} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.plNo}
                    onChange={e => setEditPartData({ ...editPartData, plNo: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.partNo}
                    onChange={e => setEditPartData({ ...editPartData, partNo: e.target.value })}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.description}
                    onChange={e => setEditPartData({ ...editPartData, description: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Rate</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.rate}
                    onChange={e => setEditPartData({ ...editPartData, rate: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Stock</label>
                  <input
                    type="number"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.stock}
                    onChange={e => setEditPartData({ ...editPartData, stock: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Location</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={editPartData.location}
                    onChange={e => setEditPartData({ ...editPartData, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                    value={editPartData.whetherUse}
                    onChange={e => setEditPartData({ ...editPartData, whetherUse: e.target.value })}
                    required
                  >
                    <option value="CS">CS</option>
                    <option value="MS">MS</option>
                    <option value="T&P">T&P</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                {!isEmployee && (
                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                      <select
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-700"
                        value={isCustomMachineEdit ? 'Other' : editPartData.machineName}
                        onChange={(e) => {
                          if (e.target.value === 'Other') {
                            setIsCustomMachineEdit(true);
                            setEditPartData({ ...editPartData, machineName: customMachineEditInput });
                          } else {
                            setIsCustomMachineEdit(false);
                            setEditPartData({ ...editPartData, machineName: e.target.value });
                          }
                        }}
                      >
                        <option value="">None / General</option>
                        {["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        {customMachines.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value="Other">Other (Type custom)</option>
                      </select>
                    </div>
                    {isCustomMachineEdit && (
                      <div>
                        <label className="block text-xs font-bold uppercase text-secondary mb-1">Type Machine Name</label>
                        <input
                          type="text"
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-semibold text-slate-800"
                          value={customMachineEditInput}
                          onChange={(e) => {
                            setCustomMachineEditInput(e.target.value);
                            setEditPartData({ ...editPartData, machineName: e.target.value });
                          }}
                          placeholder="e.g. NEW-MACHINE"
                          required
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-2">Item Image (Optional)</label>
                  <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                    <div className="relative w-24 h-24 rounded bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm group">
                      {editPartData.imageUrl ? (
                        <>
                          <img src={editPartData.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setEditPartData(prev => ({ ...prev, imageUrl: '' }))}
                            className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <Camera size={24} />
                          <span className="text-[9px] font-bold uppercase tracking-wider mt-1">No Image</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 w-full">
                      <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-4 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png"
                          onChange={(e) => handleImageUpload(e, true)}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <Upload size={18} className="text-indigo-500 mb-1" />
                        <p className="text-xs font-bold text-slate-700">Click or Drag Image Here</p>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={editPartData.remarks || ''}
                    onChange={e => setEditPartData({ ...editPartData, remarks: e.target.value })}
                    placeholder="Enter remarks for this item..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-primary">Transaction History</h2>
                <div className="text-xs text-on-surface-variant font-bold uppercase tracking-widest mt-1.5 flex flex-wrap gap-x-3 gap-y-1 items-center">
                  <span className="text-indigo-950">Item: {selectedPart?.description}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-indigo-700">Part No: {selectedPart?.partNo || '-'}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-indigo-900">PL No: {selectedPart?.plNo || '-'}</span>
                </div>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-surface-container-highest">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider">Date</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider">Total Qty</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {history.map((h) => (
                    <tr key={h.id} className="text-sm">
                      <td className="px-4 py-3">{h.date}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-black uppercase",
                          h.type === 'received' ? "bg-green-100 text-green-700" :
                          h.type === 'issued' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"
                        )}>
                          {h.type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold">{h.qty}</td>
                      <td className="px-4 py-3 font-black text-indigo-700">{h.runningBalance !== undefined ? h.runningBalance : '-'}</td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant font-medium">
                        {h.type === 'issued' ? (
                          <div className="space-y-0.5">
                            <div className="text-indigo-950 font-bold">Receiver: {h.receiverName || h.details?.replace('Issued to: ', '') || '-'}</div>
                            {h.remarks && <div className="text-slate-500">Remarks: {h.remarks}</div>}
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-emerald-800">{h.details || 'Stock Added'}</div>
                            {h.remarks && <div className="text-slate-500">Remarks: {h.remarks}</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-outline italic">No transaction history found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-6 bg-surface-container-low flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-6 py-2 bg-primary text-white text-sm font-bold rounded shadow-md hover:bg-indigo-800"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Confirm Delete</h2>
              <button onClick={() => setShowDeleteModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-on-surface-variant">
                Are you sure you want to delete this item? This action cannot be undone and will remove all associated stock data.
              </p>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeletePart}
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Confirm Delete
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </motion.div>
  );
}
