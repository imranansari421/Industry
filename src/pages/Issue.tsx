import React, { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, doc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Send, Search, X, AlertCircle, Loader2 } from 'lucide-react';
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
  machineName?: string;
}

import { findEmployeeForUser } from '../utils/employee';
import { motion, AnimatePresence } from 'motion/react';

export default function Issue() {
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

  const [parts, setParts] = useState<Part[]>([]);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [issueData, setIssueData] = useState({
    qty: 0,
    date: format(new Date(), 'yyyy-MM-dd'),
    receiverName: '',
    remarks: '',
  });

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
      const partList = querySnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Part))
        .filter(p => p.stock > 0);
      
      // Extract custom machines from parts list
      const uniqueMachines = Array.from(new Set(partList.map(p => p.machineName).filter((m): m is string => !!m)));
      const standardMachines = ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
      const extraMachines = uniqueMachines.filter(m => !standardMachines.includes(m));
      setCustomMachines(extraMachines);

      setParts(partList);
    } catch (error) {
      console.error('Error fetching parts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleIssuePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPart) return;

    if (issueData.qty > selectedPart.stock) {
      toast.error('Issue quantity cannot exceed available stock.');
      return;
    }

    setSubmitting(true);
    try {
      const batch = writeBatch(db);

      // Update stock in parts catalog
      const partRef = doc(db, 'parts', selectedPart.id);
      const newStock = selectedPart.stock - issueData.qty;
      const newTotalValue = newStock * selectedPart.rate;

      batch.update(partRef, {
        stock: newStock,
        totalValue: newTotalValue,
      });

      // Add to transaction history
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        partId: selectedPart.id,
        type: 'issued',
        qty: issueData.qty,
        date: issueData.date,
        remarks: issueData.remarks,
        receiverName: issueData.receiverName,
        details: `Issued to: ${issueData.receiverName}`,
      });

      await batch.commit();
      toast.success('Part issued successfully');
      setShowIssueModal(false);
      fetchParts();
      setIssueData({
        qty: 0,
        date: format(new Date(), 'yyyy-MM-dd'),
        receiverName: '',
        remarks: '',
      });
    } catch (error) {
      console.error('Error issuing part:', error);
      toast.error('Failed to issue part. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
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
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">Issue Module</h1>
          {!isEmployee ? (
            <div className="flex items-center gap-2">
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                value={selectedCompany}
                onChange={e => setSelectedCompany(e.target.value)}
              >
                <option value="all">All Companies</option>
                {companiesList.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
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
        <div className="relative w-full md:w-64 group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-outline group-focus-within:text-primary transition-colors" size={18} />
          <input
            type="text"
            placeholder="Search PL No, Part No..."
            className="w-full pl-10 pr-4 py-2 border border-outline/20 rounded-lg text-sm focus:ring-1 focus:ring-primary outline-none transition-all"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-surface-container-low p-4 rounded-lg flex items-center gap-3 text-sm text-on-surface-variant border border-outline-variant/20"
      >
        <AlertCircle className="text-primary" size={20} />
        Only items with available stock are displayed here for issuance.
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredParts.map((part, idx) => (
            <motion.div 
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ delay: idx * 0.05 }}
              key={part.id} 
              className="bg-white rounded-lg p-6 shadow-sm border border-outline-variant/10 hover:border-primary/30 transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary bg-primary/5 px-2 py-0.5 rounded">
                    {part.plNo}
                  </span>
                  <h3 className="text-sm font-bold text-on-surface mt-2 line-clamp-1">{part.description}</h3>
                  <p className="text-xs text-on-surface-variant font-mono mt-1">{part.partNo}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black text-primary">{Number.isNaN(part.stock) ? 0 : (part.stock || 0)}</div>
                  <div className="text-[10px] uppercase font-bold text-outline">Available</div>
                </div>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-outline-variant/10">
                <div className="text-xs font-bold text-on-surface-variant">
                  Loc: <span className="text-on-surface">{part.location || 'N/A'}</span>
                </div>
                <button
                  onClick={() => {
                    setSelectedPart(part);
                    setIssueData({ ...issueData, qty: 1 });
                    setShowIssueModal(true);
                  }}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-5 py-2.5 rounded-lg text-xs font-black shadow-md hover:from-indigo-700 hover:to-blue-700 hover:shadow-lg active:scale-95 transition-all transform"
                >
                  Issue Item <Send size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {filteredParts.length === 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="col-span-full py-20 text-center text-outline italic"
          >
            No items available for issuance matching your search.
          </motion.div>
        )}
      </div>

      {/* Issue Modal */}
      <AnimatePresence>
        {showIssueModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
                <h2 className="text-xl font-bold text-primary">Issue Item</h2>
                <button onClick={() => setShowIssueModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleIssuePart} className="p-6 space-y-4">
                <div className="bg-surface-container-low p-3 rounded text-xs">
                  <div className="font-bold text-primary mb-1">{selectedPart?.description}</div>
                  <div className="flex justify-between text-on-surface-variant">
                    <span>PL No: {selectedPart?.plNo}</span>
                    <span>Available: {selectedPart?.stock}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Issue Quantity</label>
                  <input
                    type="number"
                    min="1"
                    max={selectedPart?.stock}
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={issueData.qty || ''}
                    onChange={e => setIssueData({ ...issueData, qty: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Date</label>
                  <input
                    type="date"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={issueData.date}
                    onChange={e => setIssueData({ ...issueData, date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Receiver's Details</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm font-medium"
                    value={issueData.receiverName}
                    onChange={e => setIssueData({ ...issueData, receiverName: e.target.value })}
                    required
                    placeholder="E.g. John Doe / PF No. 49302"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Remarks</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={issueData.remarks}
                    onChange={e => setIssueData({ ...issueData, remarks: e.target.value })}
                    required
                    placeholder="E.g. Main Station Maintenance"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowIssueModal(false)}
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
                    Confirm Issue
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
