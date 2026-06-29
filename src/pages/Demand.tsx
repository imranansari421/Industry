import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, addDoc, getDocs, updateDoc, doc, query, where, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Plus, Search, CheckCircle, XCircle, Clock, X, Loader2, Edit, Trash2, ArrowUpRight, Camera, Upload, Download } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

export interface Demand {
  id: string;
  plNo: string;
  partNo?: string;
  description?: string;
  qty: number;
  date: string;
  status: 'pending' | 'completed' | 'rejected';
  receivedQty?: number;
  receivedDate?: string;
  whetherUse?: string;
  remarks?: string;
  forwardedTo?: string;
  forwardedToName?: string;
  forwardedToEmail?: string;
  createdByUid?: string;
  createdByEmail?: string;
  createdByEmployeeName?: string;
  createdByPfNo?: string;
  rejectReason?: string;
  machineName?: string;
  imageUrl?: string;
  forwardedToAdmin?: boolean;
  forwardedToAdminAt?: string;
}

interface Part {
  id: string;
  plNo: string;
  description: string;
  partNo: string;
  rate: number;
  stock: number;
  totalValue: number;
  location: string;
}

import { findEmployeeForUser } from '../utils/employee';

export default function Demand() {
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessType = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return !isEmployee || userAccessType === 'full' || userAccessType === 'admin-light';
  });
  const [isLightAdmin, setIsLightAdmin] = useState(() => {
    const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
    const userAccessType = localStorage.getItem(`accessType_${auth.currentUser?.uid}`) || 'limited';
    return isEmployee && userAccessType === 'admin-light';
  });

  const [selectedMachine, setSelectedMachine] = useState('all');
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [customMachines, setCustomMachines] = useState<string[]>([]);
  const [isCustomMachineNew, setIsCustomMachineNew] = useState(false);
  const [customMachineNewInput, setCustomMachineNewInput] = useState('');
  const [isCustomMachineEdit, setIsCustomMachineEdit] = useState(false);
  const [customMachineEditInput, setCustomMachineEditInput] = useState('');

  const [fullAccessEmployees, setFullAccessEmployees] = useState<any[]>([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardingDemand, setForwardingDemand] = useState<Demand | null>(null);
  const [selectedForwardEmployeeId, setSelectedForwardEmployeeId] = useState('');

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingDemandId, setRejectingDemandId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');

  const fetchFullAccessEmployees = async () => {
    try {
      const q = query(collection(db, 'employees'), where('accessType', '==', 'full'));
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFullAccessEmployees(list);
    } catch (error) {
      console.error("Error fetching full access employees:", error);
    }
  };

  const [currentEmployeeName, setCurrentEmployeeName] = useState<string>('');
  const [currentEmployeePfNo, setCurrentEmployeePfNo] = useState<string>('');

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
          setIsLightAdmin(emp.accessType === 'admin-light');
          setCurrentEmployeeName(emp.name || '');
          setCurrentEmployeePfNo(emp.pfNo || '');
          const mName = emp.machineName || '';
          setUserMachine(mName);
          localStorage.setItem(`userMachineName_${auth.currentUser.uid}`, mName);
        }
      }
    };
    checkAccess();
    fetchFullAccessEmployees();
  }, []);

  const [demands, setDemands] = useState<Demand[]>([]);
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [companiesList, setCompaniesList] = useState<string[]>([]);
  const [employeeList, setEmployeeList] = useState<any[]>([]);
  const [parts, setParts] = useState<Record<string, number>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDemand, setSelectedDemand] = useState<Demand | null>(null);
  const [demandToDelete, setDemandToDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [newDemand, setNewDemand] = useState({
    plNo: '',
    partNo: '',
    description: '',
    qty: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    whetherUse: 'CS',
    remarks: '',
    forwardedToId: '',
    machineName: '',
    imageUrl: '',
  });

  const [editDemandData, setEditDemandData] = useState<Demand>({
    id: '',
    plNo: '',
    partNo: '',
    description: '',
    qty: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'pending',
    whetherUse: 'CS',
    remarks: '',
    forwardedTo: '',
    forwardedToName: '',
    forwardedToEmail: '',
    createdByUid: '',
    createdByEmail: '',
    rejectReason: '',
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
        setEditDemandData(prev => ({ ...prev, imageUrl: base64 }));
      } else {
        setNewDemand(prev => ({ ...prev, imageUrl: base64 }));
      }
    };
    reader.readAsDataURL(file);
  };

  const [receiveData, setReceiveData] = useState({
    receivedQty: 0,
    receivedDate: format(new Date(), 'yyyy-MM-dd'),
    location: '',
    rate: 0,
    remarks: '',
  });

  useEffect(() => {
    fetchDemands();
    fetchParts();
  }, []);

  const fetchParts = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'parts'));
      const stockMap: Record<string, number> = {};
      querySnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.plNo) stockMap[data.plNo] = data.stock || 0;
      });
      setParts(stockMap);
    } catch (error) {
      console.error('Error fetching parts:', error);
    }
  };

  const fetchDemands = async () => {
    setLoading(true);
    try {
      // Fetch all employees to get companies mapping
      const empSnapshot = await getDocs(collection(db, 'employees'));
      const empList = empSnapshot.docs.map(doc => doc.data());
      setEmployeeList(empList);
      const uniqueCos = Array.from(new Set(empList.map(e => e.companyName).filter((c): c is string => !!c))) as string[];
      setCompaniesList(uniqueCos);

      const querySnapshot = await getDocs(collection(db, 'demands'));
      const demandList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Demand));
      
      // Extract custom machines from demands list
      const uniqueMachines = Array.from(new Set(demandList.map(d => d.machineName).filter((m): m is string => !!m)));
      const standardMachines = ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setDemands(demandList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (error) {
      console.error('Error fetching demands:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const selectedEmp = fullAccessEmployees.find(emp => emp.id === newDemand.forwardedToId);
      const machineToAssign = isEmployee ? userMachine : newDemand.machineName;
      await addDoc(collection(db, 'demands'), {
        plNo: newDemand.plNo || '',
        partNo: newDemand.partNo,
        description: newDemand.description,
        qty: newDemand.qty,
        date: newDemand.date,
        whetherUse: newDemand.whetherUse,
        remarks: newDemand.remarks,
        status: 'pending',
        createdByUid: auth.currentUser?.uid || '',
        createdByEmail: auth.currentUser?.email || '',
        createdByEmployeeName: currentEmployeeName || '',
        createdByPfNo: currentEmployeePfNo || '',
        forwardedTo: newDemand.forwardedToId || '',
        forwardedToName: selectedEmp ? selectedEmp.name : '',
        forwardedToEmail: selectedEmp ? selectedEmp.email || '' : '',
        machineName: machineToAssign || '',
        imageUrl: newDemand.imageUrl || '',
      });
      
      if (selectedEmp && selectedEmp.email) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: selectedEmp.email,
          title: 'Demand Forwarded to You',
          message: `A new demand for PL No. ${newDemand.plNo} has been forwarded to you by ${auth.currentUser?.email || 'an employee'}.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });
      }

      toast.success('Demand created successfully');
      setShowAddModal(false);
      fetchDemands();
      setNewDemand({
        plNo: '',
        partNo: '',
        description: '',
        qty: 0,
        date: format(new Date(), 'yyyy-MM-dd'),
        whetherUse: 'CS',
        remarks: '',
        forwardedToId: '',
        machineName: '',
        imageUrl: '',
      });
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
    } catch (error) {
      console.error('Error adding demand:', error);
      toast.error('Failed to create demand. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const exportDemands = (type: 'pending' | 'completed') => {
    // Filter demands by status
    const filtered = demands.filter(d => {
      const matchesSearch = d.plNo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesMachine = selectedMachine === 'all' || d.machineName === selectedMachine;
      const matchesStatus = type === 'completed' ? (d.status === 'completed') : (d.status !== 'completed');
      
      const creator = employeeList.find(e => 
        (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
        (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
        (e.id && d.createdByUid && e.id === d.createdByUid)
      );
      const demandCompany = creator ? creator.companyName || '' : '';
      const matchesCompany = selectedCompany === 'all' || demandCompany === selectedCompany;

      return matchesSearch && matchesMachine && matchesStatus && matchesCompany;
    });

    if (filtered.length === 0) {
      toast.error(`No ${type} demands found to export.`);
      return;
    }

    const dataToExport = filtered.map(d => ({
      'Date': d.date,
      'PL No.': d.plNo,
      'Part No.': d.partNo || '-',
      'Description': d.description || '-',
      'Quantity': d.qty,
      'Status': d.status.toUpperCase(),
      'Machine': d.machineName || 'General',
      'Whether Use': d.whetherUse || 'CS',
      'Created By Name': d.createdByEmployeeName || '-',
      'PF No.': d.createdByPfNo || (d.createdByEmail ? d.createdByEmail.split('@')[0] : '-'),
      'Assigned/Forwarded To': d.forwardedToName || '-',
      'Received Qty': d.receivedQty !== undefined ? d.receivedQty : '-',
      'Received Date': d.receivedDate || '-',
      'Remarks': d.remarks || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${type.toUpperCase()} Demands`);
    XLSX.writeFile(wb, `${type}_demands_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success(`${type.toUpperCase()} demands exported successfully`);
  };

  const handleExportAll = () => {
    const filtered = demands.filter(d => {
      const matchesSearch = d.plNo.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesMachine = selectedMachine === 'all' || d.machineName === selectedMachine;
      
      const creator = employeeList.find(e => 
        (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
        (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
        (e.id && d.createdByUid && e.id === d.createdByUid)
      );
      const demandCompany = creator ? creator.companyName || '' : '';
      const matchesCompany = selectedCompany === 'all' || demandCompany === selectedCompany;

      return matchesSearch && matchesMachine && matchesCompany;
    });

    if (filtered.length === 0) {
      toast.error('No demands found to export.');
      return;
    }

    const dataToExport = filtered.map(d => ({
      'Date': d.date,
      'PL No.': d.plNo,
      'Part No.': d.partNo || '-',
      'Description': d.description || '-',
      'Quantity': d.qty,
      'Status': d.status.toUpperCase(),
      'Machine': d.machineName || 'General',
      'Whether Use': d.whetherUse || 'CS',
      'Created By Name': d.createdByEmployeeName || '-',
      'PF No.': d.createdByPfNo || (d.createdByEmail ? d.createdByEmail.split('@')[0] : '-'),
      'Assigned/Forwarded To': d.forwardedToName || '-',
      'Received Qty': d.receivedQty !== undefined ? d.receivedQty : '-',
      'Received Date': d.receivedDate || '-',
      'Remarks': d.remarks || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `All Demands`);
    XLSX.writeFile(wb, `all_demands_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('All demands exported successfully');
  };

  const handleReceiveDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDemand) return;

    setSubmitting(true);
    try {
      // First, find the part
      let partsQuery;
      if (selectedDemand.plNo) {
        partsQuery = query(collection(db, 'parts'), where('plNo', '==', selectedDemand.plNo));
      } else if (selectedDemand.partNo) {
        partsQuery = query(collection(db, 'parts'), where('partNo', '==', selectedDemand.partNo));
      }

      if (!partsQuery) {
        toast.error('Demand has no PL No. or Part No.');
        setSubmitting(false);
        return;
      }

      const partsSnap = await getDocs(partsQuery);
      
      if (partsSnap.empty) {
        toast.error("Phle Inventory me Item create karo uske baad ki item received hoga otherwise item not received", {
          duration: 6000
        });
        setSubmitting(false);
        return;
      }

      const batch = writeBatch(db);
      let partId: string;

      // Update existing part
      const partDoc = partsSnap.docs[0];
      const partData = partDoc.data() as Part;
      partId = partDoc.id;

      const newStock = partData.stock + receiveData.receivedQty;
      const newRate = receiveData.rate || partData.rate;
      const newLocation = receiveData.location || partData.location;
      const newTotalValue = newStock * newRate;

      batch.update(doc(db, 'parts', partId), {
        stock: newStock,
        rate: newRate,
        location: newLocation,
        totalValue: newTotalValue,
      });

      // Update demand status
      const demandRef = doc(db, 'demands', selectedDemand.id);
      batch.update(demandRef, {
        status: 'completed',
        receivedQty: receiveData.receivedQty,
        receivedDate: receiveData.receivedDate,
      });

      // Add to transaction history
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        partId: partId,
        type: 'received',
        qty: receiveData.receivedQty,
        date: receiveData.receivedDate,
        details: `Received from demand${receiveData.remarks ? `: ${receiveData.remarks}` : ''}`,
        remarks: receiveData.remarks || '',
      });

      await batch.commit();
      toast.success('Demand received and Inventory updated');
      setShowReceiveModal(false);
      fetchDemands();
    } catch (error) {
      console.error('Error receiving demand:', error);
      toast.error('Failed to receive demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmployee) {
      toast.error('Only the Super Admin has permission to edit demands.');
      return;
    }
    setSubmitting(true);
    try {
      const demandRef = doc(db, 'demands', editDemandData.id);
      const machineToAssign = isEmployee ? userMachine : editDemandData.machineName;
      await updateDoc(demandRef, {
        plNo: editDemandData.plNo || '',
        partNo: editDemandData.partNo || '',
        description: editDemandData.description || '',
        qty: editDemandData.qty,
        date: editDemandData.date,
        status: editDemandData.status,
        whetherUse: editDemandData.whetherUse || 'CS',
        remarks: editDemandData.remarks || '',
        machineName: machineToAssign || '',
        imageUrl: editDemandData.imageUrl || '',
      });
      toast.success('Demand updated successfully');
      setShowEditModal(false);
      fetchDemands();
    } catch (error) {
      console.error('Error editing demand:', error);
      toast.error('Failed to update demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDemand = async () => {
    if (isEmployee) {
      toast.error('Only the Super Admin has permission to delete demands.');
      return;
    }
    if (isLightAdmin) {
      toast.error('Admin-light users do not have permission to delete demands.');
      return;
    }
    if (!demandToDelete) return;
    setSubmitting(true);
    try {
      await deleteDoc(doc(db, 'demands', demandToDelete));
      toast.success('Demand deleted successfully');
      setShowDeleteModal(false);
      setDemandToDelete(null);
      fetchDemands();
    } catch (error) {
      console.error('Error deleting demand:', error);
      toast.error('Failed to delete demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForwardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forwardingDemand || !selectedForwardEmployeeId) return;
    setSubmitting(true);
    try {
      const selectedEmp = fullAccessEmployees.find(emp => emp.id === selectedForwardEmployeeId);
      if (selectedEmp) {
        await updateDoc(doc(db, 'demands', forwardingDemand.id), {
          forwardedTo: selectedEmp.id,
          forwardedToName: selectedEmp.name,
          forwardedToEmail: selectedEmp.email || '',
        });

        // Send notification to the forwarded employee
        await addDoc(collection(db, 'notifications'), {
          targetEmail: selectedEmp.email || '',
          title: 'Demand Forwarded to You',
          message: `A demand for PL No. ${forwardingDemand.plNo} has been forwarded to you by ${auth.currentUser?.email || 'an employee'}.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });

        toast.success(`Demand forwarded to ${selectedEmp.name} successfully`);
      }
      setShowForwardModal(false);
      setForwardingDemand(null);
      setSelectedForwardEmployeeId('');
      fetchDemands();
    } catch (error) {
      console.error('Error forwarding demand:', error);
      toast.error('Failed to forward demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectClick = (demandId: string) => {
    setRejectingDemandId(demandId);
    setRejectReasonInput('');
    setShowRejectModal(true);
  };

  const submitRejection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingDemandId) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'demands', rejectingDemandId), {
        status: 'rejected',
        rejectReason: rejectReasonInput,
      });

      // Send notification to the creator of the demand
      const dObj = demands.find(d => d.id === rejectingDemandId);
      if (dObj && dObj.createdByEmail) {
        await addDoc(collection(db, 'notifications'), {
          targetEmail: dObj.createdByEmail,
          title: 'Demand Rejected',
          message: `Your demand for PL No. ${dObj.plNo} has been rejected. Reason: ${rejectReasonInput}`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });
      }

      toast.success('Demand rejected with reason');
      setShowRejectModal(false);
      setRejectingDemandId(null);
      setRejectReasonInput('');
      fetchDemands();
    } catch (error) {
      console.error('Error rejecting demand:', error);
      toast.error('Failed to reject demand.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForwardDemandToAdmin = async (demandId: string) => {
    try {
      const dRef = doc(db, 'demands', demandId);
      await updateDoc(dRef, {
        forwardedToAdmin: true,
        forwardedToAdminAt: new Date().toISOString(),
      });
      toast.success('Demand forwarded to Super Admin successfully!');
      fetchDemands();
    } catch (error) {
      console.error('Error forwarding demand to admin:', error);
      toast.error('Failed to forward demand to Super Admin.');
    }
  };

  const filteredDemands = demands.filter(d => {
    const plNo = d.plNo || '';
    const partNo = d.partNo || '';
    const search = searchTerm.toLowerCase();
    
    const matchesSearch = plNo.toLowerCase().includes(search) || 
                          partNo.toLowerCase().includes(search);
                          
    if (!matchesSearch) return false;

    // Apply company filter constraint
    if (!isEmployee && selectedCompany !== 'all') {
      const creator = employeeList.find(e => 
        (e.email && d.createdByEmail && e.email.toLowerCase() === d.createdByEmail.toLowerCase()) ||
        (e.pfNo && d.createdByPfNo && e.pfNo.toLowerCase() === d.createdByPfNo.toLowerCase()) ||
        (e.id && d.createdByUid && e.id === d.createdByUid)
      );
      const demandCompany = creator ? creator.companyName || '' : '';
      if (demandCompany !== selectedCompany) {
        return false;
      }
    }

    // Apply machine filter constraint
    if (isEmployee && isAdmin) {
      if (userMachine) {
        return d.machineName === userMachine;
      }
    }
    if (!isEmployee && selectedMachine !== 'all') {
      return d.machineName === selectedMachine;
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
          <h1 className="text-3xl font-black text-primary tracking-tight">Demand Module</h1>
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
              placeholder="Search PL No..."
              className="pl-10 pr-4 py-2 border border-outline/20 rounded-xl text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all w-64"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <button
            type="button"
            onClick={() => exportDemands('pending')}
            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
            title="Export Pending and Rejected Demands"
          >
            <Download size={16} /> Pending Export
          </button>

          <button
            type="button"
            onClick={() => exportDemands('completed')}
            className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
            title="Export Completed Demands"
          >
            <Download size={16} /> Complete Export
          </button>

          <button
            type="button"
            onClick={handleExportAll}
            className="flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
            title="Export All Demands"
          >
            <Download size={16} /> Export All
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-gradient-to-br from-primary to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <Plus size={20} /> Create Demand
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-x-auto">
        <table className="w-full text-left min-w-[800px]">
          <thead className="bg-surface-container-highest">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Date</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">PL No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Part No.</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Description</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Whether Use</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Remarks</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Current Stock</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Demand Qty</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Total Stock</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Received Qty</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider">Received Date</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            {filteredDemands.map((demand) => (
              <tr key={demand.id} className={cn(
                "hover:bg-surface-container-low transition-colors",
                demand.status !== 'pending' && "bg-surface-container-low/50 opacity-80"
              )}>
                <td className="px-6 py-4 text-sm">{demand.date}</td>
                <td className="px-6 py-4 text-xs font-mono font-bold text-primary">{demand.plNo}</td>
                 <td className="px-6 py-4 text-xs font-mono">{demand.partNo || '-'}</td>
                <td className="px-6 py-4 text-sm font-medium">
                  <div className="flex items-center gap-3">
                    {demand.imageUrl && (
                      <div className="w-10 h-10 rounded border border-slate-200/60 overflow-hidden flex-shrink-0 bg-slate-50 flex items-center justify-center">
                        <img src={demand.imageUrl} alt={demand.description} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div>
                      <div>{demand.description || '-'}</div>
                      {(() => {
                        const pfNo = demand.createdByPfNo || (demand.createdByEmail ? demand.createdByEmail.split('@')[0] : '');
                        if (demand.createdByEmployeeName) {
                          return (
                            <div className="text-[10px] text-indigo-700 font-bold mt-0.5">
                              By: {demand.createdByEmployeeName} {pfNo ? `(${pfNo})` : ''}
                            </div>
                          );
                        } else if (pfNo) {
                          return (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              By: {pfNo}
                            </div>
                          );
                        }
                        return null;
                      })()}
                      {demand.forwardedToName && (
                        <div className="text-[10px] text-indigo-500 font-bold mt-0.5">Assigned/Forwarded to: {demand.forwardedToName}</div>
                      )}
                      {demand.forwardedToAdmin && (
                        <div className="text-[10px] text-purple-600 font-bold mt-0.5">Escalated to Master Admin</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm">
                  <span className={cn(
                    "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm",
                    demand.whetherUse === 'CS' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                    demand.whetherUse === 'MS' ? "bg-indigo-50 text-indigo-700 border border-indigo-200" :
                    demand.whetherUse === 'T&P' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                    "bg-amber-50 text-amber-700 border border-amber-200"
                  )}>
                    {demand.whetherUse || 'CS'}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-on-surface-variant max-w-xs truncate" title={demand.remarks}>
                  {demand.remarks || '-'}
                </td>
                <td className="px-6 py-4 text-sm font-bold text-indigo-600">
                  {Number.isNaN(parts[demand.plNo]) ? 0 : (parts[demand.plNo] || 0)}
                </td>
                <td className="px-6 py-4 text-sm font-bold">{demand.qty || 0}</td>
                <td className="px-6 py-4 text-sm font-black text-primary">
                  {Number.isNaN((parts[demand.plNo] || 0) + (demand.qty || 0)) ? 0 : ((parts[demand.plNo] || 0) + (demand.qty || 0))}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col gap-1">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-black uppercase flex items-center gap-1 w-fit",
                      demand.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                      demand.status === 'completed' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    )}>
                      {demand.status === 'pending' && <Clock size={10} />}
                      {demand.status === 'completed' && <CheckCircle size={10} />}
                      {demand.status === 'rejected' && <XCircle size={10} />}
                      {demand.status}
                    </span>
                    {demand.status === 'rejected' && demand.rejectReason && (
                      <div className="text-[11px] text-red-600 font-bold bg-red-50 p-1 rounded border border-red-100 max-w-[150px] break-words" title={demand.rejectReason}>
                        Reason: {demand.rejectReason}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm">{demand.receivedQty || '-'}</td>
                <td className="px-6 py-4 text-sm">{demand.receivedDate || '-'}</td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1.5 items-center">
                    {demand.status === 'pending' ? (
                      <>
                        {isAdmin ? (
                          <>
                            {isEmployee && isAdmin && !demand.forwardedToAdmin && (
                              <button
                                onClick={() => handleForwardDemandToAdmin(demand.id)}
                                className="p-2 text-purple-600 hover:bg-purple-50 rounded transition-colors flex items-center justify-center animate-pulse"
                                title="Forward to Super Admin"
                              >
                                <ArrowUpRight size={18} />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedDemand(demand);
                                setReceiveData({ 
                                  receivedQty: demand.qty, 
                                  receivedDate: format(new Date(), 'yyyy-MM-dd'),
                                  location: '',
                                  rate: 0,
                                  remarks: '',
                                });
                                setShowReceiveModal(true);
                              }}
                              className="p-2 text-green-600 hover:bg-green-50 rounded transition-colors flex items-center justify-center"
                              title="Mark as Received"
                            >
                              <CheckCircle size={18} />
                            </button>
                            <button
                              onClick={() => handleRejectClick(demand.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center"
                              title="Reject Demand"
                            >
                              <XCircle size={18} />
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            {demand.forwardedTo ? (
                              <>
                                <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold border border-slate-200 cursor-not-allowed">
                                  Forwarded
                                </span>
                                <button
                                  onClick={() => {
                                    setSelectedDemand(demand);
                                    setReceiveData({ 
                                      receivedQty: demand.qty, 
                                      receivedDate: format(new Date(), 'yyyy-MM-dd'),
                                      location: '',
                                      rate: 0,
                                      remarks: '',
                                    });
                                    setShowReceiveModal(true);
                                  }}
                                  className="p-2 text-green-600 hover:bg-green-50 rounded transition-colors flex items-center justify-center"
                                  title="Mark as Received"
                                >
                                  <CheckCircle size={18} />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => {
                                  setForwardingDemand(demand);
                                  setSelectedForwardEmployeeId('');
                                  setShowForwardModal(true);
                                }}
                                className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-all border border-indigo-200 animate-pulse"
                                title="Forward to Full Access Employee"
                              >
                                Forward
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] font-bold text-outline uppercase mr-2">Locked</span>
                    )}

                    {!isEmployee && (
                      <>
                        <button
                          onClick={() => {
                            setEditDemandData({
                              id: demand.id,
                              plNo: demand.plNo,
                              partNo: demand.partNo || '',
                              description: demand.description || '',
                              qty: demand.qty,
                              date: demand.date,
                              status: demand.status,
                              whetherUse: demand.whetherUse || 'CS',
                              remarks: demand.remarks || '',
                              forwardedTo: demand.forwardedTo || '',
                              forwardedToName: demand.forwardedToName || '',
                              forwardedToEmail: demand.forwardedToEmail || '',
                              createdByUid: demand.createdByUid || '',
                              createdByEmail: demand.createdByEmail || '',
                              rejectReason: demand.rejectReason || '',
                              machineName: demand.machineName || '',
                              imageUrl: demand.imageUrl || '',
                            });
                            const standardMachines = ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
                            const mName = demand.machineName || '';
                            if (mName && !standardMachines.includes(mName)) {
                              setIsCustomMachineEdit(true);
                              setCustomMachineEditInput(mName);
                            } else {
                              setIsCustomMachineEdit(false);
                              setCustomMachineEditInput('');
                            }
                            setShowEditModal(true);
                          }}
                          className="p-2 text-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center"
                          title="Edit Demand"
                        >
                          <Edit size={18} />
                        </button>
                          <button
                            onClick={() => {
                              setDemandToDelete(demand.id);
                              setShowDeleteModal(true);
                            }}
                            className="p-2 text-red-400 hover:text-red-600 transition-colors flex items-center justify-center"
                            title="Delete Demand"
                          >
                            <Trash2 size={18} />
                          </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Demand Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Create New Demand</h2>
              <button onClick={() => setShowAddModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleAddDemand} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 border border-outline/20 rounded px-3 py-2 text-sm"
                    value={newDemand.plNo}
                    onChange={e => setNewDemand({ ...newDemand, plNo: e.target.value })}
                  />
                  {newDemand.plNo && parts[newDemand.plNo] !== undefined && (
                    <div className="bg-indigo-50 px-3 py-2 rounded border border-indigo-100 flex flex-col justify-center">
                      <span className="text-[10px] font-bold text-indigo-600 uppercase leading-none">Stock</span>
                      <span className="text-sm font-black text-indigo-700 leading-none">
                        {Number.isNaN(parts[newDemand.plNo]) ? 0 : parts[newDemand.plNo]}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={newDemand.partNo}
                  onChange={e => setNewDemand({ ...newDemand, partNo: e.target.value })}
                />
              </div>
               <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={newDemand.description}
                  onChange={e => setNewDemand({ ...newDemand, description: e.target.value })}
                  placeholder="Item description"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-2">Item Image (Optional)</label>
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                  <div className="relative w-20 h-20 rounded bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm group">
                    {newDemand.imageUrl ? (
                      <>
                        <img src={newDemand.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setNewDemand(prev => ({ ...prev, imageUrl: '' }))}
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center text-slate-400">
                        <Camera size={20} />
                        <span className="text-[9px] font-bold uppercase tracking-wider mt-1">No Image</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 w-full">
                    <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-3 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png"
                        onChange={(e) => handleImageUpload(e, false)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Upload size={16} className="text-indigo-500 mb-1" />
                      <p className="text-xs font-bold text-slate-700">Click or Drag Image</p>
                      <p className="text-[9px] text-slate-400 mt-0.5 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                <select
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                  value={newDemand.whetherUse}
                  onChange={e => setNewDemand({ ...newDemand, whetherUse: e.target.value })}
                  required
                >
                  <option value="CS">CS</option>
                  <option value="MS">MS</option>
                  <option value="T&P">T&P</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {!isEmployee && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-700"
                      value={isCustomMachineNew ? 'Other' : newDemand.machineName}
                      onChange={(e) => {
                        if (e.target.value === 'Other') {
                          setIsCustomMachineNew(true);
                          setNewDemand({ ...newDemand, machineName: customMachineNewInput });
                        } else {
                          setIsCustomMachineNew(false);
                          setNewDemand({ ...newDemand, machineName: e.target.value });
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
                          setNewDemand({ ...newDemand, machineName: e.target.value });
                        }}
                        placeholder="e.g. NEW-MACHINE"
                        required
                      />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={newDemand.remarks}
                  onChange={e => setNewDemand({ ...newDemand, remarks: e.target.value })}
                  placeholder="Enter remarks (if any)"
                />
              </div>
              {!isAdmin && (
                <div>
                  <label className="block text-xs font-bold uppercase text-indigo-600 mb-1">Forward to (Full Access Employee)</label>
                  <select
                    className="w-full border border-indigo-200 focus:ring-indigo-500 rounded px-3 py-2 text-sm bg-white font-medium"
                    value={newDemand.forwardedToId}
                    onChange={e => setNewDemand({ ...newDemand, forwardedToId: e.target.value })}
                  >
                    <option value="">-- Select Full Access Employee (Optional) --</option>
                    {fullAccessEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.designation || 'No designation'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity</label>
                <input
                  type="number"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={newDemand.qty}
                  onChange={e => setNewDemand({ ...newDemand, qty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Date</label>
                <input
                  type="date"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={newDemand.date}
                  onChange={e => setNewDemand({ ...newDemand, date: e.target.value })}
                  required
                />
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
                  Save Demand
                </button>
              </div>
            </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Receive Demand Modal */}
      <AnimatePresence>
        {showReceiveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Receive Demand</h2>
              <button onClick={() => setShowReceiveModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleReceiveDemand} className="p-6 space-y-4">
              <div className="flex justify-between items-center bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                <div>
                  <p className="text-[10px] font-black uppercase text-indigo-600 leading-none mb-1">PL No.</p>
                  <p className="text-sm font-bold text-indigo-900 leading-none">{selectedDemand?.plNo}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase text-indigo-600 leading-none mb-1">Current Stock</p>
                  <p className="text-sm font-black text-indigo-700 leading-none">
                    {selectedDemand?.plNo && parts[selectedDemand.plNo] !== undefined 
                      ? (Number.isNaN(parts[selectedDemand.plNo]) ? 0 : parts[selectedDemand.plNo]) 
                      : 0}
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Received Quantity</label>
                <input
                  type="number"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.receivedQty}
                  onChange={e => setReceiveData({ ...receiveData, receivedQty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Rate (Optional)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.rate}
                  onChange={e => setReceiveData({ ...receiveData, rate: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  placeholder="Leave 0 to keep current rate"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Location (Optional)</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.location}
                  onChange={e => setReceiveData({ ...receiveData, location: e.target.value })}
                  placeholder="Leave empty to keep current location"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Received Date</label>
                <input
                  type="date"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.receivedDate}
                  onChange={e => setReceiveData({ ...receiveData, receivedDate: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks (Optional)</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={receiveData.remarks}
                  onChange={e => setReceiveData({ ...receiveData, remarks: e.target.value })}
                  placeholder="Enter remarks for this receipt"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-bold rounded shadow-lg hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                  Confirm Receipt
                </button>
              </div>
            </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Demand Modal */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
            <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
              <h2 className="text-xl font-bold text-primary">Edit Demand</h2>
              <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEditDemand} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">PL No. (Optional)</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editDemandData.plNo}
                  onChange={e => setEditDemandData({ ...editDemandData, plNo: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Part No.</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editDemandData.partNo}
                  onChange={e => setEditDemandData({ ...editDemandData, partNo: e.target.value })}
                />
              </div>
               <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Description</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editDemandData.description}
                  onChange={e => setEditDemandData({ ...editDemandData, description: e.target.value })}
                  placeholder="Item description"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-2">Item Image (Optional)</label>
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                  <div className="relative w-20 h-20 rounded bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm group">
                    {editDemandData.imageUrl ? (
                      <>
                        <img src={editDemandData.imageUrl} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setEditDemandData(prev => ({ ...prev, imageUrl: '' }))}
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-wider"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center text-slate-400">
                        <Camera size={20} />
                        <span className="text-[9px] font-bold uppercase tracking-wider mt-1">No Image</span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 w-full">
                    <div className="relative border border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-3 text-center cursor-pointer transition-all bg-white hover:bg-slate-50 flex flex-col items-center justify-center">
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png"
                        onChange={(e) => handleImageUpload(e, true)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <Upload size={16} className="text-indigo-500 mb-1" />
                      <p className="text-xs font-bold text-slate-700">Click or Drag Image</p>
                      <p className="text-[9px] text-slate-400 mt-0.5 font-semibold">JPG, JPEG, PNG only (Max 300kb)</p>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Whether Use</label>
                <select
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                  value={editDemandData.whetherUse}
                  onChange={e => setEditDemandData({ ...editDemandData, whetherUse: e.target.value })}
                  required
                >
                  <option value="CS">CS</option>
                  <option value="MS">MS</option>
                  <option value="T&P">T&P</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {!isEmployee && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold text-slate-700"
                      value={isCustomMachineEdit ? 'Other' : editDemandData.machineName}
                      onChange={(e) => {
                        if (e.target.value === 'Other') {
                          setIsCustomMachineEdit(true);
                          setEditDemandData({ ...editDemandData, machineName: customMachineEditInput });
                        } else {
                          setIsCustomMachineEdit(false);
                          setEditDemandData({ ...editDemandData, machineName: e.target.value });
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
                          setEditDemandData({ ...editDemandData, machineName: e.target.value });
                        }}
                        placeholder="e.g. NEW-MACHINE"
                        required
                      />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                <input
                  type="text"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editDemandData.remarks || ''}
                  onChange={e => setEditDemandData({ ...editDemandData, remarks: e.target.value })}
                  placeholder="Enter remarks (if any)"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Quantity</label>
                <input
                  type="number"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editDemandData.qty}
                  onChange={e => setEditDemandData({ ...editDemandData, qty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Date</label>
                <input
                  type="date"
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                  value={editDemandData.date}
                  onChange={e => setEditDemandData({ ...editDemandData, date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-secondary mb-1">Status</label>
                <select
                  className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white font-bold"
                  value={editDemandData.status}
                  onChange={e => setEditDemandData({ ...editDemandData, status: e.target.value as any })}
                  required
                >
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="rejected">Rejected</option>
                </select>
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
                <h2 className="text-xl font-bold text-primary">Confirm Delete</h2>
                <button onClick={() => setShowDeleteModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-on-surface-variant">
                  Are you sure you want to delete this demand? This action cannot be undone.
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
                    onClick={handleDeleteDemand}
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

      {/* Forward Demand Modal */}
      <AnimatePresence>
        {showForwardModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-indigo-50">
                <h2 className="text-xl font-bold text-indigo-900">Forward Demand</h2>
                <button onClick={() => setShowForwardModal(false)} className="text-indigo-600 hover:text-indigo-900">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleForwardSubmit} className="p-6 space-y-4">
                <p className="text-sm text-slate-600">
                  Select a full-access employee to forward this demand for PL No. <strong className="text-indigo-700">{forwardingDemand?.plNo}</strong>.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-indigo-600 mb-1">Full Access Employee</label>
                  <select
                    className="w-full border border-indigo-200 focus:ring-indigo-500 rounded px-3 py-2 text-sm bg-white font-medium"
                    value={selectedForwardEmployeeId}
                    onChange={e => setSelectedForwardEmployeeId(e.target.value)}
                    required
                  >
                    <option value="">-- Select Recipient --</option>
                    {fullAccessEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.designation || 'Full Access'})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowForwardModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !selectedForwardEmployeeId}
                    className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white text-sm font-bold rounded shadow-lg hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Forward Demand
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reject Demand Modal with Reason */}
      <AnimatePresence>
        {showRejectModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-red-50">
                <h2 className="text-xl font-bold text-red-900">Reject Demand</h2>
                <button onClick={() => setShowRejectModal(false)} className="text-red-600 hover:text-red-900">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={submitRejection} className="p-6 space-y-4">
                <p className="text-sm text-slate-600">
                  Please provide a reason for rejecting this demand. The rejection reason will be displayed directly to the employee.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-red-600 mb-1">Rejection Reason</label>
                  <textarea
                    rows={3}
                    className="w-full border border-red-200 focus:ring-red-500 rounded px-3 py-2 text-sm bg-white font-medium"
                    value={rejectReasonInput}
                    onChange={e => setRejectReasonInput(e.target.value)}
                    placeholder="Type the rejection reason here..."
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowRejectModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !rejectReasonInput.trim()}
                    className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Confirm Reject
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
