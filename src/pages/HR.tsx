import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, updateDoc, doc, query, where, setDoc, writeBatch, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { findEmployeeForUser } from '../utils/employee';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { Plus, Trash2, Download, Eye, X, Loader2, Camera, Upload, Edit2, Check, XCircle, UserCheck, Bell, Settings, ArrowUpRight, Undo, Factory, TrendingUp, History } from 'lucide-react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface Employee {
  id: string;
  name: string;
  mobile: string;
  email: string;
  designation: string;
  address: string;
  doj: string;
  dob?: string;
  photoUrl: string;
  status: 'active' | 'left';
  employeeId?: string;
  doe?: string;
  pfNo?: string;
  esicNo?: string;
  accessType?: 'full' | 'limited' | 'admin-light';
  machineName?: string;
  qualification?: string;
  companyName?: string;
  companyGst?: string;
  companyMobile?: string;
  companyEmail?: string;
  companyAddress?: string;
  companyDept?: string;
  fatherName?: string;
  employmentHistory?: {
    companyName: string;
    designation: string;
    doj: string;
    leftDate: string;
    status: 'left';
  }[];
  designationHistory?: {
    oldDesignation: string;
    newDesignation: string;
    updatedAt: string;
    type: 'promotion' | 'demotion' | 'correction' | 'initial';
  }[];
}

export default function HR() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [autofillMessage, setAutofillMessage] = useState<string | null>(null);
  const [designationChangeType, setDesignationChangeType] = useState<'promotion' | 'demotion' | 'correction' | 'initial'>('promotion');
  const [companyMachineSearch, setCompanyMachineSearch] = useState<string>('all');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [exitDate, setExitDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // New tab and request states for profile approvals
  const [activeTab, setActiveTab] = useState<'employees' | 'approvals' | 'companies'>('employees');
  const [selectedCompanyForView, setSelectedCompanyForView] = useState<string | null>(null);
  const [profileRequests, setProfileRequests] = useState<any[]>([]);
  const [currentEmployeeId, setCurrentEmployeeId] = useState<string>('');
  const [requestRemarks, setRequestRemarks] = useState<Record<string, string>>({});
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});

  const [isEmployee, setIsEmployee] = useState(() => {
    return auth.currentUser?.email?.endsWith('@employee.billedapp.com') || false;
  });
  const [currentUserAccessType, setCurrentUserAccessType] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || 'limited' : 'limited';
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    const isEmp = auth.currentUser?.email?.endsWith('@employee.billedapp.com') || false;
    if (!isEmp) return true;
    const storedAccess = auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) : null;
    return storedAccess === 'full' || storedAccess === 'admin-light';
  });

  // Machine management states
  const [selectedMachine, setSelectedMachine] = useState('all');
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [userMachine, setUserMachine] = useState<string>(() => {
    return localStorage.getItem(`userMachineName_${auth.currentUser?.uid}`) || '';
  });
  const [customMachines, setCustomMachines] = useState<string[]>([]);
  const [isCustomMachineNew, setIsCustomMachineNew] = useState(false);
  const [customMachineNewInput, setCustomMachineNewInput] = useState('');
  const [isCustomMachineEdit, setIsCustomMachineEdit] = useState(false);
  const [customMachineEditInput, setCustomMachineEditInput] = useState('');

  const [machinesList, setMachinesList] = useState<string[]>(() => {
    return ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"];
  });

  // Group employees by company dynamically
  const companiesListComputed = React.useMemo(() => {
    const map: Record<string, {
      name: string;
      gst: string;
      mobile: string;
      email: string;
      address: string;
      dept: string;
      employeesCount: number;
      adminLightEmployees: string[];
      machineCounts: Record<string, number>;
    }> = {};

    employees.forEach(emp => {
      const cName = emp.companyName?.trim();
      if (!cName) return;
      if (!map[cName]) {
        map[cName] = {
          name: cName,
          gst: '',
          mobile: '',
          email: '',
          address: '',
          dept: '',
          employeesCount: 0,
          adminLightEmployees: [],
          machineCounts: {},
        };
      }
      if (emp.status === 'active') {
        map[cName].employeesCount += 1;
        if (emp.machineName) {
          const mName = emp.machineName.trim();
          map[cName].machineCounts[mName] = (map[cName].machineCounts[mName] || 0) + 1;
        }
      }
      
      // If this employee is admin-light, capture company details
      if (emp.accessType === 'admin-light') {
        map[cName].gst = emp.companyGst || map[cName].gst;
        map[cName].mobile = emp.companyMobile || map[cName].mobile;
        map[cName].email = emp.companyEmail || map[cName].email;
        map[cName].address = emp.companyAddress || map[cName].address;
        map[cName].dept = emp.companyDept || map[cName].dept;
        map[cName].adminLightEmployees.push(emp.name);
      }
    });

    return Object.values(map);
  }, [employees]);
  const [appTitle, setAppTitle] = useState(() => {
    return localStorage.getItem('appTitle') || "Active Engineers Railway";
  });
  const [fbLink, setFbLink] = useState("https://www.facebook.com/share/19u6U4CPNy/");
  const [igLink, setIgLink] = useState("https://www.instagram.com/imran_ansari000_?igsh=MTRqdGpuNDc2OHV1bA==");
  const [webLink, setWebLink] = useState("#");
  const [tgLink, setTgLink] = useState("https://t.me/+0LJ53SSjdXFmZDk1");

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsAppTitle, setSettingsAppTitle] = useState("");
  const [settingsFbLink, setSettingsFbLink] = useState("");
  const [settingsIgLink, setSettingsIgLink] = useState("");
  const [settingsWebLink, setSettingsWebLink] = useState("");
  const [settingsTgLink, setSettingsTgLink] = useState("");

  const [newMachineInput, setNewMachineInput] = useState("");
  const [editingMachineIndex, setEditingMachineIndex] = useState<number | null>(null);
  const [editingMachineValue, setEditingMachineValue] = useState("");

  const [newEmployee, setNewEmployee] = useState({
    name: '',
    mobile: '',
    email: '',
    designation: '',
    address: '',
    doj: format(new Date(), 'yyyy-MM-dd'),
    dob: '',
    photoUrl: '',
    pfNo: '',
    esicNo: '',
    qualification: '',
    accessType: 'limited' as 'full' | 'limited' | 'admin-light',
    machineName: '',
    companyName: '',
    companyGst: '',
    companyMobile: '',
    companyEmail: '',
    companyAddress: '',
    companyDept: '',
    fatherName: '',
  });

  // Create Company states
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [newCompanyData, setNewCompanyData] = useState({
    name: '',
    gst: '',
    mobile: '',
    email: '',
    address: '',
    dept: '',
    loginId: '',
    password: '',
  });

  const handleCreateCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyData.name || !newCompanyData.gst || !newCompanyData.loginId || !newCompanyData.password) {
      toast.error("Please fill in all required company details.");
      return;
    }
    setSubmitting(true);
    try {
      // Create company admin-light employee document
      await addDoc(collection(db, 'employees'), {
        name: `${newCompanyData.name} Admin`,
        mobile: newCompanyData.mobile,
        email: newCompanyData.email,
        designation: 'Company Administrator',
        address: newCompanyData.address,
        doj: new Date().toISOString().split('T')[0],
        dob: '',
        photoUrl: '',
        status: 'active',
        pfNo: `COMP-${newCompanyData.loginId.toUpperCase()}`,
        esicNo: '',
        accessType: 'admin-light',
        machineName: '',
        companyName: newCompanyData.name,
        companyGst: newCompanyData.gst,
        companyMobile: newCompanyData.mobile,
        companyEmail: newCompanyData.email,
        companyAddress: newCompanyData.address,
        companyDept: newCompanyData.dept,
        loginId: newCompanyData.loginId.trim().toLowerCase(),
        password: newCompanyData.password,
        firstTimeLogin: true,
      });

      toast.success(`Company ${newCompanyData.name} created successfully! Admin login ID is: ${newCompanyData.loginId}`);
      setShowCreateCompanyModal(false);
      setNewCompanyData({
        name: '',
        gst: '',
        mobile: '',
        email: '',
        address: '',
        dept: '',
        loginId: '',
        password: '',
      });
      fetchEmployees();
    } catch (error) {
      console.error("Error creating company:", error);
      toast.error("Failed to create company.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCompany || !editingCompany.companyName || !editingCompany.companyGst || !editingCompany.loginId || !editingCompany.password) {
      toast.error("Please fill in all required company details.");
      return;
    }
    setSubmitting(true);
    try {
      const originalEmp = employees.find(e => e.id === editingCompany.id);
      const originalCompanyName = originalEmp ? (originalEmp.companyName || '') : '';
      const newCompanyName = editingCompany.companyName;

      const { doc, updateDoc, writeBatch, collection, query, where, getDocs } = await import('firebase/firestore');
      const empRef = doc(db, 'employees', editingCompany.id);
      const batch = writeBatch(db);

      batch.update(empRef, {
        name: `${newCompanyName} Admin`,
        mobile: editingCompany.mobile || '',
        email: editingCompany.email || '',
        address: editingCompany.companyAddress || '',
        companyName: newCompanyName,
        companyGst: editingCompany.companyGst,
        companyMobile: editingCompany.mobile || '',
        companyEmail: editingCompany.email || '',
        companyAddress: editingCompany.companyAddress || '',
        companyDept: editingCompany.companyDept || '',
        loginId: editingCompany.loginId.trim().toLowerCase(),
        password: editingCompany.password,
      });

      if (originalCompanyName && originalCompanyName !== newCompanyName) {
        // Query other employees under the old company and update their companyName and GST
        const employeesRef = collection(db, 'employees');
        const empQuery = query(employeesRef, where('companyName', '==', originalCompanyName));
        const empDocs = await getDocs(empQuery);
        empDocs.forEach((d) => {
          if (d.id !== editingCompany.id) {
            batch.update(doc(db, 'employees', d.id), {
              companyName: newCompanyName,
              companyGst: editingCompany.companyGst,
            });
          }
        });

        // Query profile_requests for the old company and update their companyName
        const reqsRef = collection(db, 'profile_requests');
        const reqQuery = query(reqsRef, where('companyName', '==', originalCompanyName));
        const reqDocs = await getDocs(reqQuery);
        reqDocs.forEach((d) => {
          batch.update(doc(db, 'profile_requests', d.id), {
            companyName: newCompanyName
          });
        });
      }

      await batch.commit();

      toast.success(`Company ${newCompanyName} profile updated successfully!`);
      setEditingCompany(null);
      fetchEmployees();
    } catch (error) {
      console.error("Error editing company:", error);
      toast.error("Failed to update company profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCompany = async (companyName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete company "${companyName}"? All employees and profile update requests associated with this company will be deleted.`)) {
      return;
    }
    setSubmitting(true);
    try {
      const { collection, query, where, getDocs, doc, writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);

      // Query and delete all employees under this company
      const employeesRef = collection(db, 'employees');
      const empQuery = query(employeesRef, where('companyName', '==', companyName));
      const empDocs = await getDocs(empQuery);
      empDocs.forEach((d) => {
        batch.delete(doc(db, 'employees', d.id));
      });

      // Query and delete all profile requests under this company
      const reqsRef = collection(db, 'profile_requests');
      const reqQuery = query(reqsRef, where('companyName', '==', companyName));
      const reqDocs = await getDocs(reqQuery);
      reqDocs.forEach((d) => {
        batch.delete(doc(db, 'profile_requests', d.id));
      });

      await batch.commit();

      toast.success(`Company "${companyName}" and all associated data deleted successfully.`);
      fetchEmployees();
    } catch (error) {
      console.error("Error deleting company:", error);
      toast.error("Failed to delete company.");
    } finally {
      setSubmitting(false);
    }
  };

  // Admin Notification Modal states
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [notificationTarget, setNotificationTarget] = useState('all');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isEmp = user.email?.endsWith('@employee.billedapp.com') || false;
        setIsEmployee(isEmp);
        
        let hasFullAccess = !isEmp;
        if (isEmp && user.email) {
          try {
            const emp = await findEmployeeForUser(user.uid, user.email);
            if (emp) {
              hasFullAccess = emp.accessType === 'full' || emp.accessType === 'admin-light';
              setIsAdmin(hasFullAccess);
              setCurrentUserAccessType(emp.accessType || 'limited');
              setCurrentUserCompanyName(emp.companyName || '');
              setCurrentEmployeeId(emp.employeeId || '');
              const mName = emp.machineName || '';
              setUserMachine(mName);
              localStorage.setItem(`userMachineName_${user.uid}`, mName);
              localStorage.setItem(`accessType_${user.uid}`, emp.accessType || 'limited');
              localStorage.setItem(`companyName_${user.uid}`, emp.companyName || '');
            } else {
              setIsAdmin(false);
            }
          } catch (error) {
            console.error('Error verifying employee full access:', error);
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(true);
        }
        
        fetchEmployees(hasFullAccess);
        fetchPendingRequests(hasFullAccess);
      } else {
        setIsEmployee(false);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.machines && Array.isArray(data.machines)) {
          setMachinesList(data.machines);
        }
        if (data.appTitle) {
          setAppTitle(data.appTitle);
          localStorage.setItem('appTitle', data.appTitle);
        }
        if (data.fbLink !== undefined) setFbLink(data.fbLink);
        if (data.igLink !== undefined) setIgLink(data.igLink);
        if (data.webLink !== undefined) setWebLink(data.webLink);
        if (data.tgLink !== undefined) setTgLink(data.tgLink);
      } else {
        // Create default settings if not exists
        setDoc(doc(db, 'settings', 'general'), {
          appTitle: "Active Engineers Railway",
          machines: ["TRT-619005", "MPT", "DTE", "UTV", "BCM", "FRM", "UNIMATE", "CSM", "RGM"],
          fbLink: "https://www.facebook.com/share/19u6U4CPNy/",
          igLink: "https://www.instagram.com/imran_ansari000_?igsh=MTRqdGpuNDc2OHV1bA==",
          webLink: "#",
          tgLink: "https://t.me/+0LJ53SSjdXFmZDk1"
        }).catch(err => console.error("Error creating default settings:", err));
      }
    }, (error) => {
      console.warn("Failed to listen to general settings in HR:", error);
    });

    return () => unsubscribeSettings();
  }, []);

  const fetchEmployees = async (hasFullAccessOverride?: boolean) => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'employees'));
      let empList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      
      const fullAccess = hasFullAccessOverride !== undefined ? hasFullAccessOverride : isAdmin;
      
      // If the logged in user is an employee and doesn't have full access, do not show admin/non-employee data in the list
      if (isEmployee && !fullAccess) {
        empList = empList.filter(emp => emp.email && emp.email.endsWith('@employee.billedapp.com'));
      }

      // Extract custom machine names dynamically
      const uniqueMachines = Array.from(new Set(empList.map(e => e.machineName).filter((m): m is string => !!m)));
      const extraMachines = uniqueMachines.filter(m => !machinesList.includes(m));
      setCustomMachines(extraMachines);
      
      setEmployees(empList);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees.');
      handleFirestoreError(error, OperationType.LIST, 'employees');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingRequests = async (hasFullAccessOverride?: boolean) => {
    try {
      const q = query(collection(db, 'profile_requests'), where('status', '==', 'pending'));
      const querySnapshot = await getDocs(q);
      let reqList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const fullAccess = hasFullAccessOverride !== undefined ? hasFullAccessOverride : isAdmin;
      
      // Filter out admin profile requests if logged in user is an employee without full access
      if (isEmployee && !fullAccess) {
        reqList = reqList.filter((req: any) => req.email && req.email.endsWith('@employee.billedapp.com'));
      }
      
      setProfileRequests(reqList);
    } catch (error) {
      console.error('Error fetching profile requests:', error);
      handleFirestoreError(error, OperationType.LIST, 'profile_requests');
    }
  };

  const handleApproveRequest = async (request: any) => {
    try {
      // 1. Update the employee document
      const empRef = doc(db, 'employees', request.employeeId);
      await updateDoc(empRef, {
        name: request.name,
        mobile: request.mobile,
        email: request.email,
        designation: request.designation,
        address: request.address,
        dob: request.dob || '',
        pfNo: request.pfNo || '',
        esicNo: request.esicNo || '',
        doj: request.doj,
        photoUrl: request.photoUrl || '',
      });

      // 2. Also update their user profile in 'users' collection
      if (request.uid) {
        const userRef = doc(db, 'users', request.uid);
        await setDoc(userRef, {
          name: request.name,
          email: request.email,
          mobile: request.mobile,
          designation: request.designation,
          gender: request.gender || 'Male',
          address: request.address,
        }, { merge: true });
      }

      // 3. Mark the request as approved
      const reqRef = doc(db, 'profile_requests', request.id);
      await updateDoc(reqRef, {
        status: 'approved',
        approvedAt: new Date().toISOString(),
      });

      // 4. Create a notification
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Approved',
          message: `Your profile update request has been approved by the admin.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      toast.success(`Profile update for ${request.name} approved successfully!`);
      
      // Dispatch layout event to refresh any layout elements instantly
      window.dispatchEvent(new Event('profile-updated'));

      fetchEmployees();
      fetchPendingRequests();
    } catch (error) {
      console.error('Error approving profile request:', error);
      toast.error('Failed to approve profile update.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const handleRejectRequest = async (request: any) => {
    try {
      const remarks = requestRemarks[request.id]?.trim();
      if (!remarks) {
        toast.error('Please enter a reason/remarks for rejecting this request.');
        return;
      }

      const reqRef = doc(db, 'profile_requests', request.id);
      await updateDoc(reqRef, {
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        remarks: remarks,
      });

      // Create a notification
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Rejected',
          message: `Your profile update request has been rejected. Reason: ${remarks}`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'rejection'
        });
      }

      toast.success('Profile update request rejected.');
      fetchPendingRequests();
    } catch (error) {
      console.error('Error rejecting profile request:', error);
      toast.error('Failed to reject profile request.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const handleReturnRequest = async (request: any) => {
    try {
      const remarks = requestRemarks[request.id]?.trim();
      if (!remarks) {
        toast.error('Please enter a reason/remarks for returning this request.');
        return;
      }

      const reqRef = doc(db, 'profile_requests', request.id);
      await updateDoc(reqRef, {
        status: 'returned',
        remarks: remarks,
        returnedAt: new Date().toISOString(),
      });

      // Create a notification
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Returned',
          message: `Your profile update request was returned for correction. Reason: ${remarks}`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'rejection'
        });
      }

      toast.success('Profile update request returned to employee for corrections.');
      fetchPendingRequests();
    } catch (error) {
      console.error('Error returning profile request:', error);
      toast.error('Failed to return profile request.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const handleForwardRequest = async (request: any) => {
    try {
      const remarks = requestRemarks[request.id]?.trim() || '';
      const reqRef = doc(db, 'profile_requests', request.id);
      
      // Determine company context of the employee requesting profile changes
      const empRecord = employees.find(e => e.pfNo === request.pfNo || e.employeeId === request.employeeId);
      const companyName = empRecord?.companyName || request.companyName || '';

      await updateDoc(reqRef, {
        forwardedToAdmin: true,
        forwardedToCompanyAdmin: true,
        companyName: companyName,
        forwardedAt: new Date().toISOString(),
        remarks: remarks || request.remarks || ''
      });

      // Create a notification for the user about forwarding
      if (request.uid) {
        await addDoc(collection(db, 'notifications'), {
          uid: request.uid,
          title: 'Profile Request Forwarded',
          message: `Your profile update request was forwarded to the Company Admin for final review.`,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'approval'
        });
      }

      toast.success('Profile update request forwarded to Company Admin successfully!');
      fetchPendingRequests();
    } catch (error) {
      console.error('Error forwarding profile request:', error);
      toast.error('Failed to forward profile request.');
      handleFirestoreError(error, OperationType.WRITE, `profile_requests/${request.id}`);
    }
  };

  const getChangeDiff = (request: any) => {
    const original = employees.find(emp => emp.id === request.employeeId);
    if (!original) return null;

    const changes = [];
    if (original.name !== request.name) {
      changes.push({ label: 'Name', oldVal: original.name, newVal: request.name });
    }
    if (original.mobile !== request.mobile) {
      changes.push({ label: 'Mobile', oldVal: original.mobile, newVal: request.mobile });
    }
    if (original.designation !== request.designation) {
      changes.push({ label: 'Designation', oldVal: original.designation, newVal: request.designation });
    }
    if ((original.address || '') !== (request.address || '')) {
      changes.push({ label: 'Address', oldVal: original.address || 'None', newVal: request.address || 'None' });
    }
    if ((original.dob || '') !== (request.dob || '')) {
      changes.push({ label: 'DOB', oldVal: original.dob || 'None', newVal: request.dob || 'None' });
    }
    if ((original.pfNo || '') !== (request.pfNo || '')) {
      changes.push({ label: 'PF Number', oldVal: original.pfNo || 'None', newVal: request.pfNo || 'None' });
    }
    if ((original.esicNo || '') !== (request.esicNo || '')) {
      changes.push({ label: 'ESIC Number', oldVal: original.esicNo || 'None', newVal: request.esicNo || 'None' });
    }
    if (original.doj !== request.doj) {
      changes.push({ label: 'Date of Joining', oldVal: original.doj, newVal: request.doj });
    }
    if ((original.photoUrl || '') !== (request.photoUrl || '')) {
      changes.push({ 
        label: 'Photo', 
        oldVal: 'Old Photo', 
        newVal: 'New Photo', 
        isPhoto: true, 
        oldPhoto: original.photoUrl, 
        newPhoto: request.photoUrl 
      });
    }

    return changes;
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          if (isEdit) {
            setEditingEmployee(prev => prev ? { ...prev, photoUrl: compressedBase64 } : null);
          } else {
            setNewEmployee(prev => ({ ...prev, photoUrl: compressedBase64 }));
          }
          toast.success('Photo uploaded and processed successfully');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const addMachineToConfigIfNeeded = async (machineName: string) => {
    if (!machineName) return;
    if (!machinesList.includes(machineName)) {
      try {
        const updatedList = [...machinesList, machineName];
        await setDoc(doc(db, 'settings', 'general'), {
          machines: updatedList
        }, { merge: true });
      } catch (error) {
        console.error("Error auto-adding custom machine to settings:", error);
      }
    }
  };

  const handleSaveAppTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsAppTitle.trim()) {
      toast.error("App title cannot be empty.");
      return;
    }
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        appTitle: settingsAppTitle.trim()
      }, { merge: true });
      toast.success("App Title updated successfully!");
    } catch (error) {
      console.error("Error saving app title:", error);
      toast.error("Failed to update app title.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveFooterLinks = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        fbLink: settingsFbLink.trim(),
        igLink: settingsIgLink.trim(),
        webLink: settingsWebLink.trim(),
        tgLink: settingsTgLink.trim()
      }, { merge: true });
      toast.success("Footer links updated successfully!");
    } catch (error) {
      console.error("Error saving footer links:", error);
      toast.error("Failed to update footer links.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachineInput.trim()) {
      toast.error("Machine name cannot be empty.");
      return;
    }
    const val = newMachineInput.trim();
    if (machinesList.includes(val)) {
      toast.error("Machine name already exists.");
      return;
    }
    const updated = [...machinesList, val];
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        machines: updated
      }, { merge: true });
      setNewMachineInput("");
      toast.success("Machine added successfully!");
    } catch (error) {
      console.error("Error adding machine:", error);
      toast.error("Failed to add machine.");
    }
  };

  const handleEditMachineSave = async (index: number) => {
    if (!editingMachineValue.trim()) {
      toast.error("Machine name cannot be empty.");
      return;
    }
    const val = editingMachineValue.trim();
    if (machinesList.includes(val) && machinesList[index] !== val) {
      toast.error("Machine name already exists.");
      return;
    }
    const oldVal = machinesList[index];
    const updated = [...machinesList];
    updated[index] = val;
    setSubmitting(true);
    try {
      // 1. Update general settings
      await setDoc(doc(db, 'settings', 'general'), {
        machines: updated
      }, { merge: true });

      // 2. Cascade rename to collections if the name changed
      if (oldVal && oldVal !== val) {
        const { writeBatch, query, collection, where, getDocs } = await import('firebase/firestore');
        const batch = writeBatch(db);

        // Update employees
        const empsSnap = await getDocs(query(collection(db, 'employees'), where('machineName', '==', oldVal)));
        empsSnap.forEach((d) => {
          batch.update(doc(db, 'employees', d.id), { machineName: val });
        });

        // Update parts
        const partsSnap = await getDocs(query(collection(db, 'parts'), where('machineName', '==', oldVal)));
        partsSnap.forEach((d) => {
          batch.update(doc(db, 'parts', d.id), { machineName: val });
        });

        // Update demands
        const demandsSnap = await getDocs(query(collection(db, 'demands'), where('machineName', '==', oldVal)));
        demandsSnap.forEach((d) => {
          batch.update(doc(db, 'demands', d.id), { machineName: val });
        });

        await batch.commit();
        toast.success(`Machine renamed and changes propagated to associated records!`);
      } else {
        toast.success("Machine updated successfully!");
      }

      setEditingMachineIndex(null);
      setEditingMachineValue("");
      fetchEmployees();
    } catch (error) {
      console.error("Error updating machine:", error);
      toast.error("Failed to update machine.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMachine = async (index: number) => {
    if (!window.confirm("Are you sure you want to delete this machine?")) return;
    const updated = machinesList.filter((_, idx) => idx !== index);
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        machines: updated
      }, { merge: true });
      toast.success("Machine deleted successfully!");
    } catch (error) {
      console.error("Error deleting machine:", error);
      toast.error("Failed to delete machine.");
    }
  };

  const checkAndAutofillPfNo = (pfVal: string) => {
    if (!pfVal) return;
    const cleanPf = pfVal.trim().toUpperCase();
    if (cleanPf.length < 3) return;
    
    const match = employees.find(e => e.pfNo?.trim().toUpperCase() === cleanPf);
    if (match) {
      const joinDate = match.doj ? new Date(match.doj) : null;
      const exitDate = match.doe ? new Date(match.doe) : (match.status === 'left' ? new Date() : null);
      let days = 0;
      if (joinDate && exitDate) {
        const diffTime = Math.abs(exitDate.getTime() - joinDate.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      } else if (joinDate) {
        const diffTime = Math.abs(new Date().getTime() - joinDate.getTime());
        days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }

      setNewEmployee(prev => ({
        ...prev,
        name: match.name || prev.name,
        mobile: match.mobile || prev.mobile,
        email: match.email || prev.email,
        designation: match.designation || prev.designation,
        address: match.address || prev.address,
        dob: match.dob || prev.dob,
        photoUrl: match.photoUrl || prev.photoUrl,
        qualification: match.qualification || prev.qualification,
        fatherName: match.fatherName || prev.fatherName,
        esicNo: match.esicNo || prev.esicNo,
        employmentHistory: [
          ...(match.employmentHistory || []),
          {
            companyName: match.companyName || 'Previous Company',
            designation: match.designation || 'Employee',
            doj: match.doj || '',
            leftDate: match.doe || new Date().toISOString().split('T')[0],
            status: 'left'
          }
        ]
      }));

      setAutofillMessage(`✨ Previous profile loaded! Worked at "${match.companyName || 'Previous Company'}" for ${days} days (${match.doj || 'N/A'} to ${match.doe || 'N/A'}).`);
      toast.success("Previous employee profile loaded and career history updated!");
    } else {
      setAutofillMessage(null);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Only administrators can perform this action.');
      return;
    }
    setSubmitting(true);
    try {
      const machineToAssign = isEmployee ? userMachine : newEmployee.machineName;
      if (machineToAssign) {
        await addMachineToConfigIfNeeded(machineToAssign);
      }
      
      const finalCompanyName = isEmployee ? currentUserCompanyName : newEmployee.companyName;

      await addDoc(collection(db, 'employees'), {
        ...newEmployee,
        companyName: finalCompanyName || '',
        machineName: machineToAssign || '',
        accessType: newEmployee.accessType || 'limited',
        status: 'active',
      });
      toast.success('Employee added successfully');
      setShowAddModal(false);
      fetchEmployees();
      setNewEmployee({
        name: '',
        mobile: '',
        email: '',
        designation: '',
        address: '',
        doj: format(new Date(), 'yyyy-MM-dd'),
        dob: '',
        photoUrl: '',
        pfNo: '',
        esicNo: '',
        qualification: '',
        accessType: 'limited' as 'full' | 'limited' | 'admin-light',
        machineName: '',
        companyName: '',
        companyGst: '',
        companyMobile: '',
        companyEmail: '',
        companyAddress: '',
        companyDept: '',
        fatherName: '',
      });
      setAutofillMessage(null);
      setIsCustomMachineNew(false);
      setCustomMachineNewInput('');
    } catch (error) {
      console.error('Error adding employee:', error);
      toast.error('Failed to add employee. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee) return;
    if (!isAdmin) {
      toast.error('Only administrators can perform this action.');
      return;
    }
    setSubmitting(true);
    try {
      const empRef = doc(db, 'employees', editingEmployee.id);
      const machineToAssign = isEmployee ? userMachine : editingEmployee.machineName;
      if (machineToAssign) {
        await addMachineToConfigIfNeeded(machineToAssign);
      }

      const originalEmployee = employees.find(e => e.id === editingEmployee.id);
      let updatedDesignationHistory = editingEmployee.designationHistory || [];
      
      if (originalEmployee && originalEmployee.designation !== editingEmployee.designation) {
        let periodStart = originalEmployee.doj || '';
        if (originalEmployee.designationHistory && originalEmployee.designationHistory.length > 0) {
          const lastHistory = originalEmployee.designationHistory[originalEmployee.designationHistory.length - 1];
          if (lastHistory.updatedAt) {
            periodStart = lastHistory.updatedAt;
          }
        }
        
        const periodEnd = new Date().toISOString().split('T')[0];
        
        const historyEntry = {
          oldDesignation: originalEmployee.designation,
          newDesignation: editingEmployee.designation,
          updatedAt: periodEnd,
          type: designationChangeType,
          periodStart: periodStart,
          periodEnd: periodEnd,
        };
        
        updatedDesignationHistory = [...updatedDesignationHistory, historyEntry];
      }

      await updateDoc(empRef, {
        name: editingEmployee.name,
        mobile: editingEmployee.mobile,
        email: editingEmployee.email,
        designation: editingEmployee.designation,
        designationHistory: updatedDesignationHistory,
        address: editingEmployee.address || '',
        doj: editingEmployee.doj,
        dob: editingEmployee.dob || '',
        photoUrl: editingEmployee.photoUrl || '',
        pfNo: editingEmployee.pfNo || '',
        esicNo: editingEmployee.esicNo || '',
        qualification: editingEmployee.qualification || '',
        accessType: editingEmployee.accessType || 'limited',
        machineName: machineToAssign || '',
        companyName: editingEmployee.companyName || '',
        companyGst: editingEmployee.companyGst || '',
        companyMobile: editingEmployee.companyMobile || '',
        companyEmail: editingEmployee.companyEmail || '',
        companyAddress: editingEmployee.companyAddress || '',
        companyDept: editingEmployee.companyDept || '',
      });

      // Sync accessType to 'users' collection if a user document exists with this email or employeeId
      try {
        let usersSnap = await getDocs(query(collection(db, 'users'), where('employeeId', '==', editingEmployee.id)));
        if (usersSnap.empty) {
          usersSnap = await getDocs(query(collection(db, 'users'), where('email', '==', editingEmployee.email)));
        }
        if (!usersSnap.empty) {
          const userDoc = usersSnap.docs[0];
          await updateDoc(doc(db, 'users', userDoc.id), {
            accessType: editingEmployee.accessType || 'limited'
          });
        }
      } catch (err) {
        console.error('Error syncing accessType to users:', err);
      }

      toast.success('Employee updated successfully');
      setShowEditModal(false);
      fetchEmployees();
    } catch (error) {
      console.error('Error updating employee:', error);
      toast.error('Failed to update employee.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notificationTitle || !notificationMessage) {
      toast.error('Please enter a title and message.');
      return;
    }
    setSubmitting(true);
    try {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const usersList = usersSnapshot.docs.map(doc => doc.data());

      if (notificationTarget === 'all') {
        // 1. Create a master global notification
        await addDoc(collection(db, 'notifications'), {
          target: 'all',
          title: notificationTitle,
          message: notificationMessage,
          createdAt: new Date().toISOString(),
          read: false,
          type: 'announcement',
        });

        // 2. Create individual notifications for currently registered users
        const batch = writeBatch(db);
        usersList.forEach(u => {
          if (u.role === 'employee' || u.uid !== auth.currentUser?.uid) {
            const notifRef = doc(collection(db, 'notifications'));
            batch.set(notifRef, {
              uid: u.uid,
              title: notificationTitle,
              message: notificationMessage,
              createdAt: new Date().toISOString(),
              read: false,
              type: 'announcement',
            });
          }
        });
        await batch.commit();
        toast.success(`Notification created and broadcasted successfully!`);
      } else {
        const selectedEmp = employees.find(emp => emp.id === notificationTarget);
        if (selectedEmp) {
          const userDoc = usersList.find(u => u.email?.toLowerCase() === selectedEmp.email?.toLowerCase());
          
          await addDoc(collection(db, 'notifications'), {
            uid: userDoc ? userDoc.uid : '',
            targetEmail: selectedEmp.email || '',
            title: notificationTitle,
            message: notificationMessage,
            createdAt: new Date().toISOString(),
            read: false,
            type: 'announcement',
          });

          if (userDoc) {
            toast.success(`Notification sent to ${selectedEmp.name} successfully!`);
          } else {
            toast.success(`Notification saved for ${selectedEmp.name}. They will see it immediately when they log in!`);
          }
        }
      }

      setShowNotificationModal(false);
      setNotificationTitle('');
      setNotificationMessage('');
      setNotificationTarget('all');
    } catch (error) {
      console.error('Error creating notification:', error);
      toast.error('Failed to send notification.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExitEmployee = async () => {
    if (!selectedEmployee) return;
    if (!isAdmin) {
      toast.error('Only administrators can perform this action.');
      return;
    }
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'employees', selectedEmployee.id), {
        status: 'left',
        doe: exitDate,
      });
      toast.success('Employee status updated');
      setShowExitModal(false);
      fetchEmployees();
    } catch (error) {
      console.error('Error updating employee status:', error);
      toast.error('Failed to update employee status.');
    } finally {
      setSubmitting(false);
    }
  };

  const [currentUserCompanyName, setCurrentUserCompanyName] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`companyName_${auth.currentUser.uid}`) || '' : '';
  });

  const filteredEmployees = employees.filter(emp => {
    // Exclude admin-light (Company Accounts) from regular employee list
    if (emp.accessType === 'admin-light') return false;

    // 1. If logged-in user is admin-light (Company Admin)
    if (isEmployee && currentUserAccessType === 'admin-light') {
      const companyMatches = emp.companyName === currentUserCompanyName;
      if (!companyMatches) return false;
      
      if (selectedMachine !== 'all') {
        return emp.machineName === selectedMachine;
      }
      return true;
    }
    
    // 2. If logged-in user is an employee with full access (Section Authority)
    if (isEmployee && currentUserAccessType === 'full') {
      if (userMachine) {
        if (emp.machineName !== userMachine) return false;
      }
    }
    
    // 3. If master admin (Top-Level Admin), apply dropdown filters
    if (!isEmployee) {
      if (selectedMachine !== 'all' && emp.machineName !== selectedMachine) {
        return false;
      }
      if (selectedCompany !== 'all' && emp.companyName !== selectedCompany) {
        return false;
      }
    }
    return true;
  });

  const filteredProfileRequests = profileRequests.filter(req => {
    // 1. If logged-in user is an employee with admin-light access (Company Admin)
    if (isEmployee && currentUserAccessType === 'admin-light') {
      return (req.forwardedToCompanyAdmin === true || req.isFullAccessAdmin === true) && 
             req.companyName === currentUserCompanyName && 
             req.status === 'pending';
    }
    // 2. If logged-in user is an employee with full access (Section Authority)
    if (isEmployee && currentUserAccessType === 'full') {
      return req.authorityId === currentEmployeeId && req.status === 'pending' && !req.forwardedToAdmin;
    }
    // 3. If master (Top-Level) admin
    if (!isEmployee) {
      if (req.status !== 'pending') return false;
      // Show if it is a general request (no authorityId) OR if it has been forwarded to admin
      const isGeneralOrForwarded = !req.authorityId || req.forwardedToAdmin === true;
      if (!isGeneralOrForwarded) return false;

      if (selectedMachine !== 'all') {
        return req.machineName === selectedMachine;
      }
      return true;
    }
    return false;
  });

  const exportLeftEmployees = () => {
    const leftEmployees = filteredEmployees.filter(emp => emp.status === 'left');
    const ws = XLSX.utils.json_to_sheet(leftEmployees);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Left Employees");
    XLSX.writeFile(wb, "Left_Employees_Report.xlsx");
  };

  const exportAllEmployees = () => {
    const ws = XLSX.utils.json_to_sheet(filteredEmployees);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "All Employees");
    XLSX.writeFile(wb, "All_Employees_Report.xlsx");
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-primary">HR Management</h1>
          {(!isEmployee || currentUserAccessType === 'admin-light') ? (
            <div className="flex gap-2">
              <select
                className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                value={selectedMachine}
                onChange={e => setSelectedMachine(e.target.value)}
              >
                <option value="all">All Machines</option>
                {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {!isEmployee && (
                <select
                  className="border border-outline/20 rounded-lg px-3 py-1.5 text-xs bg-white font-bold text-slate-700 shadow-sm animate-fade-in"
                  value={selectedCompany}
                  onChange={e => setSelectedCompany(e.target.value)}
                >
                  <option value="all">All Companies</option>
                  {companiesListComputed.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              )}
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
          {isAdmin && (
            <>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-indigo-700 hover:to-blue-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
              >
                <Plus size={18} /> Add Employee
              </button>
              <button
                onClick={() => setShowNotificationModal(true)}
                className="flex items-center gap-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-amber-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
              >
                <Bell size={18} /> Create Notification
              </button>
              {(!isEmployee || currentUserAccessType === 'admin-light') && (
                <button
                  onClick={() => {
                    setSettingsAppTitle(appTitle);
                    setSettingsFbLink(fbLink);
                    setSettingsIgLink(igLink);
                    setSettingsWebLink(webLink);
                    setSettingsTgLink(tgLink);
                    setShowSettingsModal(true);
                  }}
                  className="flex items-center gap-2 bg-gradient-to-r from-slate-600 to-zinc-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-slate-700 hover:to-zinc-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
                >
                  <Settings size={18} /> Settings
                </button>
              )}
            </>
          )}
          <button
            onClick={exportLeftEmployees}
            className="flex items-center gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-green-700 hover:to-emerald-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
          >
            <Download size={18} /> Export Left
          </button>
          <button
            onClick={exportAllEmployees}
            className="flex items-center gap-2 bg-gradient-to-r from-teal-600 to-cyan-600 text-white px-4 py-2 rounded-lg font-bold shadow hover:from-teal-700 hover:to-cyan-700 transition-all transform hover:scale-105 active:scale-95 text-sm"
          >
            <Download size={18} /> Export All
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-slate-100 pb-px">
        <button
          onClick={() => setActiveTab('employees')}
          className={cn(
            "pb-3 text-sm font-bold uppercase tracking-wider border-b-2 px-1 transition-all",
            activeTab === 'employees' 
              ? "border-indigo-900 text-indigo-900" 
              : "border-transparent text-slate-500 hover:text-indigo-700"
          )}
        >
          Employee Directory
        </button>
        {!isEmployee && (
          <button
            onClick={() => setActiveTab('companies')}
            className={cn(
              "pb-3 text-sm font-bold uppercase tracking-wider border-b-2 px-1 transition-all flex items-center gap-2",
              activeTab === 'companies' 
                ? "border-indigo-900 text-indigo-900" 
                : "border-transparent text-slate-500 hover:text-indigo-700"
            )}
          >
            <span>Companies</span>
            {companiesListComputed.length > 0 && (
              <span className="bg-slate-200 text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                {companiesListComputed.length}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setActiveTab('approvals')}
          className={cn(
            "pb-3 text-sm font-bold uppercase tracking-wider border-b-2 px-1 transition-all flex items-center gap-2",
            activeTab === 'approvals' 
              ? "border-indigo-900 text-indigo-900" 
              : "border-transparent text-slate-500 hover:text-indigo-700"
          )}
        >
          <span>Profile Approvals</span>
          {filteredProfileRequests.length > 0 && (
            <span className="bg-indigo-900 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full animate-pulse">
              {filteredProfileRequests.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'employees' ? (
        <div className="bg-white rounded-lg shadow-sm border border-outline-variant/20 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-container-highest">
              <tr>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">Photo</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">Name</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">Designation</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">Mobile</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              <AnimatePresence mode="popLayout">
                {filteredEmployees.map((emp, idx) => (
                  <motion.tr 
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: idx * 0.05 }}
                    key={emp.id} 
                    className="hover:bg-surface-container-low transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden">
                        {emp.photoUrl ? (
                          <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-outline">{emp.name.charAt(0)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-on-surface">{emp.name}</div>
                      <div className="text-xs text-on-surface-variant">{emp.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-on-surface">{emp.designation}</div>
                      <div className="text-[10px] text-on-surface-variant flex flex-col gap-0.5 mt-0.5 font-medium">
                        {emp.pfNo && (
                          <span>{emp.accessType === 'admin-light' ? 'ID No' : 'PF No'}: <span className="text-primary font-bold">{emp.pfNo}</span></span>
                        )}
                        {emp.esicNo && (
                          <span>{emp.accessType === 'admin-light' ? 'GST No' : 'ESIC No'}: <span className="text-primary font-bold">{emp.esicNo}</span></span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">{emp.mobile}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded text-[10px] font-black uppercase",
                        emp.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      )}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => {
                          setSelectedEmployee(emp);
                          setShowViewModal(true);
                        }}
                        className="p-2 text-secondary hover:text-primary transition-colors"
                        title="View Details"
                      >
                        <Eye size={18} />
                      </button>
                      {emp.status === 'active' && isAdmin && (
                        <>
                          <button
                            onClick={() => {
                              setEditingEmployee({ ...emp });
                              const mName = emp.machineName || '';
                              if (mName && !machinesList.includes(mName)) {
                                setIsCustomMachineEdit(true);
                                setCustomMachineEditInput(mName);
                              } else {
                                setIsCustomMachineEdit(false);
                                setCustomMachineEditInput('');
                              }
                              setShowEditModal(true);
                            }}
                            className="p-2 text-secondary hover:text-blue-600 transition-colors"
                            title="Edit Employee"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => {
                              setSelectedEmployee(emp);
                              setShowExitModal(true);
                            }}
                            className="p-2 text-secondary hover:text-red-600 transition-colors"
                            title="Mark as Left"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                      {emp.status === 'left' && isAdmin && (
                        <>
                          <button
                            onClick={async () => {
                              if (window.confirm(`Are you sure you want to reactivate employee "${emp.name}"?`)) {
                                try {
                                  await updateDoc(doc(db, 'employees', emp.id), {
                                    status: 'active',
                                    doe: '' // clear exit date
                                  });
                                  toast.success(`Employee "${emp.name}" reactivated successfully!`);
                                  fetchEmployees();
                                } catch (error) {
                                  console.error("Error reactivating employee:", error);
                                  toast.error("Failed to reactivate employee.");
                                }
                              }
                            }}
                            className="p-2 text-secondary hover:text-green-600 transition-colors"
                            title="Reactivate Employee"
                          >
                            <UserCheck size={18} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingEmployee({ ...emp });
                              const mName = emp.machineName || '';
                              if (mName && !machinesList.includes(mName)) {
                                setIsCustomMachineEdit(true);
                                setCustomMachineEditInput(mName);
                              } else {
                                setIsCustomMachineEdit(false);
                                setCustomMachineEditInput('');
                              }
                              setShowEditModal(true);
                            }}
                            className="p-2 text-secondary hover:text-blue-600 transition-colors"
                            title="Edit Left Employee"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={async () => {
                              if (window.confirm(`Are you sure you want to permanently delete left employee "${emp.name}"?`)) {
                                try {
                                  await deleteDoc(doc(db, 'employees', emp.id));
                                  toast.success(`Employee "${emp.name}" removed from registry.`);
                                  fetchEmployees();
                                } catch (error) {
                                  console.error("Error deleting employee:", error);
                                  toast.error("Failed to delete employee.");
                                }
                              }
                            }}
                            className="p-2 text-secondary hover:text-red-600 transition-colors"
                            title="Delete Employee permanently"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      ) : activeTab === 'companies' ? (
        /* Companies View */
        <div className="space-y-6">
          <div className="flex flex-col lg:flex-row justify-between lg:items-center bg-slate-50 p-5 rounded-2xl border border-slate-200/60 gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-800 leading-tight">Company Registry</h2>
              <p className="text-xs text-slate-500 font-semibold">Create and manage registered corporate profiles and Admin-light logins.</p>
            </div>
            
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase text-slate-500 whitespace-nowrap">Filter by Machine:</span>
                <select
                  className="border border-slate-200/80 rounded-xl px-3 py-2 text-xs font-bold bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  value={companyMachineSearch}
                  onChange={e => setCompanyMachineSearch(e.target.value)}
                >
                  <option value="all">All Machines</option>
                  {machinesList.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {isAdmin && !isEmployee && (
                <button
                  onClick={() => setShowCreateCompanyModal(true)}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md hover:shadow-indigo-600/10 transition-all transform hover:scale-[1.02] active:scale-[0.98] text-xs whitespace-nowrap"
                >
                  <Plus size={16} /> Create Company Profile
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {companiesListComputed.length === 0 ? (
              <div className="col-span-full bg-white border border-slate-100 rounded-2xl p-16 text-center shadow-sm">
                <Factory size={48} className="text-slate-300 mx-auto mb-4 animate-pulse" />
                <h3 className="text-lg font-bold text-slate-800">No Companies Configured</h3>
                <p className="text-sm text-slate-500 mt-1">Assign employees or create Admin-light users with company profiles to populate this list.</p>
              </div>
            ) : (
              companiesListComputed.map((company, index) => (
                <div key={index} className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="p-3 bg-amber-50 text-amber-700 rounded-xl border border-amber-100">
                        <Factory size={24} />
                      </div>
                      <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                        {company.employeesCount} {company.employeesCount === 1 ? 'Employee' : 'Employees'}
                      </span>
                    </div>

                    <h3 className="text-lg font-bold text-slate-800 leading-tight mb-2.5">{company.name}</h3>
                    
                    <div className="space-y-2 text-xs text-slate-600 font-medium">
                      {company.gst && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">GST:</span>
                          <span className="font-mono bg-slate-50 px-1.5 py-0.5 rounded">{company.gst}</span>
                        </div>
                      )}
                      {company.dept && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">Dept:</span>
                          <span>{company.dept}</span>
                        </div>
                      )}
                      {(company.mobile || company.email) && (
                        <div className="border-t border-slate-100 pt-2 mt-2 space-y-1">
                          {company.mobile && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">📞</span>
                              <span>{company.mobile}</span>
                            </div>
                          )}
                          {company.email && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">✉️</span>
                              <span className="truncate">{company.email}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {company.address && (
                        <div className="border-t border-slate-100 pt-2 mt-2">
                          <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Address:</p>
                          <p className="text-slate-500 leading-relaxed text-[11px] line-clamp-2">{company.address}</p>
                        </div>
                      )}

                      {/* Machine breakdown metrics */}
                      <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-1.5 flex items-center gap-1">
                          <Factory size={10} /> Machine-wise Assignments:
                        </p>
                        {Object.keys(company.machineCounts).length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic font-medium">No active machine assignments yet</p>
                        ) : companyMachineSearch === 'all' ? (
                          <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(company.machineCounts).map(([mName, mCount]) => (
                              <div key={mName} className="flex justify-between items-center text-[10px] bg-white px-2 py-1 rounded-md border border-slate-100/60 font-semibold text-slate-600">
                                <span className="truncate">{mName}</span>
                                <span className="bg-slate-100 text-slate-800 text-[9px] font-bold px-1.5 py-0.2 rounded-full">{mCount}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex justify-between items-center text-[11px] bg-indigo-50 border border-indigo-100/70 p-2 rounded-lg font-bold text-indigo-950">
                            <span className="truncate">Machine {companyMachineSearch}</span>
                            <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                              {company.machineCounts[companyMachineSearch] || 0}
                            </span>
                          </div>
                        )}
                      </div>
                      {company.adminLightEmployees.length > 0 && (
                        <div className="bg-amber-50/40 border border-amber-100/50 p-2.5 rounded-xl mt-3.5">
                          <p className="text-[10px] text-amber-800 font-bold uppercase mb-1">Company Admin:</p>
                          <div className="flex flex-wrap gap-1">
                            {company.adminLightEmployees.map((adm, aIdx) => (
                              <span key={aIdx} className="bg-amber-100/60 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                {adm}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4 mt-5 flex gap-2">
                    <button
                      onClick={() => setSelectedCompanyForView(company.name)}
                      className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 text-xs font-bold py-2 px-3 rounded-lg border border-slate-200 transition-all active:scale-[0.98] flex items-center justify-center gap-1"
                    >
                      <Eye size={14} /> Check Employees
                    </button>
                    {company.adminLightEmployees.length > 0 && (
                      <button
                        onClick={() => {
                          const adminEmp = employees.find(e => e.companyName === company.name && e.accessType === 'admin-light');
                          if (adminEmp) {
                            setEditingCompany(adminEmp);
                          }
                        }}
                        className="p-2 border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                        title="Edit Company Details"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                    {isAdmin && !isEmployee && (
                      <button
                        onClick={() => handleDeleteCompany(company.name)}
                        className="p-2 border border-slate-200 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="Delete Company Permanently"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Approvals View */
        <div className="space-y-4">
          {filteredProfileRequests.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-16 text-center shadow-sm">
              <UserCheck size={48} className="text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-800">No Pending Approvals</h3>
              <p className="text-sm text-slate-500 mt-1">All employee profile update requests have been reviewed!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              {filteredProfileRequests.map((req) => (
                <div key={req.id} className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                    <div 
                      className="flex items-center gap-4 cursor-pointer select-none group flex-1"
                      onClick={() => setExpandedRequests(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
                      title="Click to view/hide requested changes"
                    >
                      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200/60 group-hover:border-indigo-400 transition-colors">
                        {req.photoUrl ? (
                          <img src={req.photoUrl} alt={req.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-lg font-black text-slate-400">{req.name.charAt(0)}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-black text-slate-800 text-lg leading-tight group-hover:text-indigo-600 transition-colors">{req.name}</h3>
                          <span className="text-[10px] text-indigo-500 font-bold bg-indigo-50 px-1.5 py-0.5 rounded opacity-80 group-hover:opacity-100 transition-all flex items-center gap-1">
                            {expandedRequests[req.id] ? 'Hide Changes ▲' : 'Click to View Changes ▼'}
                          </span>
                        </div>
                        <p className="text-xs text-indigo-700 uppercase font-black tracking-widest mt-1">{req.designation}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <p className="text-[10px] text-slate-400 font-semibold">Submitted: {new Date(req.createdAt).toLocaleString()}</p>
                          {req.authorityName && (
                            <span className="bg-blue-50 text-blue-700 border border-blue-100 text-[9px] px-1.5 py-0.5 rounded font-bold">
                              Authority: {req.authorityName}
                            </span>
                          )}
                          {req.forwardedToAdmin && (
                            <span className="bg-purple-50 text-purple-700 border border-purple-100 text-[9px] px-1.5 py-0.5 rounded font-bold animate-pulse">
                              Forwarded to Master Admin
                            </span>
                          )}
                        </div>
                        
                        {/* Action Remarks / Reason */}
                        <div className="mt-3 max-w-md" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Enter remarks/reason (Required for Return or Reject)..."
                            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50 focus:bg-white transition-all placeholder:text-slate-400"
                            value={requestRemarks[req.id] || ''}
                            onChange={e => setRequestRemarks(prev => ({ ...prev, [req.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      {isEmployee && isAdmin ? (
                        <>
                          <button
                            onClick={() => handleReturnRequest(req)}
                            className="px-3 py-2 border border-amber-200 hover:bg-amber-50 text-amber-700 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1 shadow-sm"
                            title="Return to Employee for corrections"
                          >
                            <Undo size={14} /> Return
                          </button>
                          {currentUserAccessType === 'full' && (
                            <button
                              onClick={() => handleForwardRequest(req)}
                              className="px-3 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-sm flex items-center gap-1"
                              title="Forward to Company Admin"
                            >
                              <ArrowUpRight size={14} /> Forward
                            </button>
                          )}
                          <button
                            onClick={() => handleRejectRequest(req)}
                            className="px-3 py-2 border border-red-200 hover:bg-red-50 text-red-600 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1 shadow-sm"
                            title="Reject completely"
                          >
                            <XCircle size={14} /> Reject
                          </button>
                          <button
                            onClick={() => handleApproveRequest(req)}
                            className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-md flex items-center gap-1"
                            title="Approve directly"
                          >
                            <Check size={14} /> Approve
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleRejectRequest(req)}
                            className="px-4 py-2.5 border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm"
                          >
                            <XCircle size={14} /> Reject Request
                          </button>
                          <button
                            onClick={() => handleApproveRequest(req)}
                            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-emerald-600/10 flex items-center gap-1.5"
                          >
                            <Check size={14} /> Approve & Save
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Changes Grid */}
                  {expandedRequests[req.id] && (
                    <div className="mt-5 border-t border-slate-50 pt-4">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Requested Changes</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {getChangeDiff(req)?.map((change: any, cIdx: number) => (
                          <div key={cIdx} className="bg-slate-50/50 border border-slate-100 rounded-xl p-3.5 flex flex-col gap-1.5 shadow-inner">
                            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-900">{change.label}</span>
                            <div className="flex flex-col gap-1 text-xs">
                              {change.isPhoto ? (
                                <div className="flex items-center gap-4 mt-1">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Old</span>
                                    <div className="w-10 h-10 rounded-full overflow-hidden border">
                                      {change.oldPhoto ? <img src={change.oldPhoto} className="w-full h-full object-cover" /> : <span className="text-[8px] text-slate-400">None</span>}
                                    </div>
                                  </div>
                                  <span className="text-indigo-900 font-bold">→</span>
                                  <div className="flex flex-col items-center gap-1">
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-600">New</span>
                                    <div className="w-10 h-10 rounded-full overflow-hidden border border-emerald-500 shadow-sm">
                                      {change.newPhoto ? <img src={change.newPhoto} className="w-full h-full object-cover" /> : <span className="text-[8px] text-slate-400">None</span>}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-400 line-through truncate font-medium">Was: {change.oldVal || 'None'}</span>
                                  <span className="text-emerald-700 font-black truncate">To: {change.newVal || 'None'}</span>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Employee Modal */}
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
                <h2 className="text-xl font-bold text-primary">Add New Employee</h2>
                <button onClick={() => setShowAddModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAddEmployee} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.name}
                      onChange={e => setNewEmployee({ ...newEmployee, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Mobile</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.mobile}
                      onChange={e => setNewEmployee({ ...newEmployee, mobile: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.email}
                      onChange={e => setNewEmployee({ ...newEmployee, email: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Designation</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.designation}
                      onChange={e => setNewEmployee({ ...newEmployee, designation: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Joining</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.doj}
                      onChange={e => setNewEmployee({ ...newEmployee, doj: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Birth (DOB)</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newEmployee.dob}
                      onChange={e => setNewEmployee({ ...newEmployee, dob: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">PF Number</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                        placeholder="e.g. MH/BAN/12345/678"
                        value={newEmployee.pfNo}
                        onChange={e => setNewEmployee({ ...newEmployee, pfNo: e.target.value })}
                        onBlur={e => checkAndAutofillPfNo(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => checkAndAutofillPfNo(newEmployee.pfNo || '')}
                        className="px-3 py-1 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-bold transition-all whitespace-nowrap"
                      >
                        Find PF
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">Press Tab or click Find PF to auto-fill if they worked here previously</p>
                    {autofillMessage && (
                      <div className="mt-2 p-2.5 bg-green-50/80 border border-green-200/50 rounded-lg text-[11px] text-green-800 font-bold leading-relaxed shadow-sm">
                        {autofillMessage}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">ESIC Number</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. 31000123450001001"
                      value={newEmployee.esicNo}
                      onChange={e => setNewEmployee({ ...newEmployee, esicNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Qualification</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. B.Tech Mechanical"
                      value={newEmployee.qualification || ''}
                      onChange={e => setNewEmployee({ ...newEmployee, qualification: e.target.value })}
                    />
                  </div>
                  {(!isEmployee || currentUserAccessType !== 'admin-light') && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Company Name</label>
                      {!isEmployee ? (
                        <select
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                          value={newEmployee.companyName || ''}
                          onChange={e => {
                            const selectedCoName = e.target.value;
                            const matchedCo = companiesListComputed.find(c => c.name === selectedCoName);
                            setNewEmployee(prev => ({
                              ...prev,
                              companyName: selectedCoName,
                              companyGst: matchedCo?.gst || prev.companyGst,
                              companyMobile: matchedCo?.mobile || prev.companyMobile,
                              companyEmail: matchedCo?.email || prev.companyEmail,
                              companyAddress: matchedCo?.address || prev.companyAddress,
                              companyDept: matchedCo?.dept || prev.companyDept,
                            }));
                          }}
                        >
                          <option value="">Select Company...</option>
                          {companiesListComputed.map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          disabled
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-slate-50 cursor-not-allowed"
                          value={currentUserCompanyName || ''}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={isEmployee ? userMachine : (isCustomMachineNew ? "Other" : (newEmployee.machineName || ''))}
                      disabled={isEmployee}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === "Other") {
                          setIsCustomMachineNew(true);
                          setNewEmployee(prev => ({ ...prev, machineName: '' }));
                        } else {
                          setIsCustomMachineNew(false);
                          setNewEmployee(prev => ({ ...prev, machineName: val }));
                        }
                      }}
                      required
                    >
                      <option value="">Select Machine</option>
                      {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {!isEmployee && <option value="Other">Other (Type custom...)</option>}
                    </select>
                  </div>
                  {isCustomMachineNew && !isEmployee && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Custom Machine Name</label>
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                        value={customMachineNewInput}
                        onChange={e => {
                          setCustomMachineNewInput(e.target.value);
                          setNewEmployee(prev => ({ ...prev, machineName: e.target.value }));
                        }}
                        placeholder="Type machine name..."
                        required
                      />
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-secondary mb-2">Employee Photo</label>
                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline/10">
                      <div className="relative w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border-2 border-primary/20 shadow-md group">
                        {newEmployee.photoUrl ? (
                          <>
                            <img src={newEmployee.photoUrl} alt="Preview" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setNewEmployee(prev => ({ ...prev, photoUrl: '' }))}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center text-outline">
                            <Camera size={28} className="text-secondary/60" />
                            <span className="text-[10px] font-black uppercase tracking-wider mt-1">No Photo</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="relative border-2 border-dashed border-outline-variant/30 hover:border-primary/50 rounded-xl p-4 text-center cursor-pointer transition-all bg-surface-container-low hover:bg-surface-container-high flex flex-col items-center justify-center">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handlePhotoUpload(e, false)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <Upload size={20} className="text-primary mb-1.5" />
                          <p className="text-xs font-bold text-on-surface">Click or Drag Photo Here</p>
                          <p className="text-[10px] text-outline mt-1 font-semibold">PNG, JPG, WEBP (Auto-compressed to fit database)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {(!isEmployee || (isEmployee && currentUserAccessType === 'admin-light')) && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50 space-y-2">
                    <label className="block text-xs font-black uppercase text-indigo-900 tracking-wider">Access Control</label>
                    <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                      Choose whether this employee has full administrative access or non-access (profile-only).
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="addAccessType"
                          value="full"
                          checked={newEmployee.accessType === 'full'}
                          onChange={() => setNewEmployee({ ...newEmployee, accessType: 'full' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Full Access (Admin)
                        </span>
                      </label>
                      {!isEmployee && (
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="addAccessType"
                            value="admin-light"
                            checked={newEmployee.accessType === 'admin-light'}
                            onChange={() => setNewEmployee({ ...newEmployee, accessType: 'admin-light' })}
                            className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                          />
                          <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                            Admin-light (Company Admin)
                          </span>
                        </label>
                      )}
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="addAccessType"
                          value="limited"
                          checked={newEmployee.accessType === 'limited'}
                          onChange={() => setNewEmployee({ ...newEmployee, accessType: 'limited' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Non-Access (Profile-only)
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {newEmployee.accessType === 'admin-light' && (
                  <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/40 space-y-3">
                    <h3 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-1.5">
                      <Factory size={14} /> Company Settings (Required for Admin-light)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Name</label>
                        <input
                          type="text"
                          required={newEmployee.accessType === 'admin-light'}
                          placeholder="e.g. Acme Corporation"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyName || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">GST Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 27AAAAA1111A1Z1"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyGst || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyGst: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Mobile</label>
                        <input
                          type="text"
                          placeholder="e.g. +91 9876543210"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyMobile || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyMobile: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Email</label>
                        <input
                          type="email"
                          placeholder="e.g. contact@acme.com"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyEmail || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyEmail: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Department Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Engineering & IT"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={newEmployee.companyDept || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyDept: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Address</label>
                        <textarea
                          placeholder="Full address of the company..."
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white h-12 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                          value={newEmployee.companyAddress || ''}
                          onChange={e => setNewEmployee({ ...newEmployee, companyAddress: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Address</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={newEmployee.address}
                    onChange={e => setNewEmployee({ ...newEmployee, address: e.target.value })}
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
                    Save Employee
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Employee Modal */}
      <AnimatePresence>
        {showEditModal && editingEmployee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary">Edit Employee Details</h2>
                <button onClick={() => setShowEditModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleEditEmployee} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Name</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.name}
                      onChange={e => setEditingEmployee({ ...editingEmployee, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Mobile</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.mobile}
                      onChange={e => setEditingEmployee({ ...editingEmployee, mobile: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.email}
                      onChange={e => setEditingEmployee({ ...editingEmployee, email: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Designation</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.designation}
                      onChange={e => setEditingEmployee({ ...editingEmployee, designation: e.target.value })}
                      required
                    />
                    {/* Show designation update type if changed */}
                    {employees.find(e => e.id === editingEmployee.id)?.designation !== editingEmployee.designation && (
                      <div className="mt-2 p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg space-y-1">
                        <label className="block text-[10px] font-black uppercase text-indigo-900">Career Event Type</label>
                        <select
                          className="w-full border border-indigo-200 rounded px-2 py-1 text-xs bg-white font-bold text-indigo-950 focus:outline-none"
                          value={designationChangeType}
                          onChange={e => setDesignationChangeType(e.target.value as any)}
                        >
                          <option value="promotion">📈 Promotion (Role Upgrade)</option>
                          <option value="demotion">📉 Demotion (Role Downgrade)</option>
                          <option value="correction">⚙️ Correction (Typo Fix / Restructure)</option>
                        </select>
                        <p className="text-[9px] text-slate-500">This categorizes the career progression entry logged to the employee profile.</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Joining</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.doj}
                      onChange={e => setEditingEmployee({ ...editingEmployee, doj: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Birth (DOB)</label>
                    <input
                      type="date"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      value={editingEmployee.dob || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, dob: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">PF Number</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. MH/BAN/12345/678"
                      value={editingEmployee.pfNo || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, pfNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">ESIC Number</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. 31000123450001001"
                      value={editingEmployee.esicNo || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, esicNo: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Qualification</label>
                    <input
                      type="text"
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                      placeholder="e.g. B.Tech Mechanical"
                      value={editingEmployee.qualification || ''}
                      onChange={e => setEditingEmployee({ ...editingEmployee, qualification: e.target.value })}
                    />
                  </div>
                  {(!isEmployee || currentUserAccessType !== 'admin-light') && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Company Name</label>
                      {!isEmployee ? (
                        <select
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                          value={editingEmployee.companyName || ''}
                          onChange={e => {
                            const selectedCoName = e.target.value;
                            const matchedCo = companiesListComputed.find(c => c.name === selectedCoName);
                            setEditingEmployee(prev => prev ? ({
                              ...prev,
                              companyName: selectedCoName,
                              companyGst: matchedCo?.gst || prev.companyGst,
                              companyMobile: matchedCo?.mobile || prev.companyMobile,
                              companyEmail: matchedCo?.email || prev.companyEmail,
                              companyAddress: matchedCo?.address || prev.companyAddress,
                              companyDept: matchedCo?.dept || prev.companyDept,
                            }) : null);
                          }}
                        >
                          <option value="">Select Company...</option>
                          {companiesListComputed.map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          disabled
                          className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-slate-50 cursor-not-allowed"
                          value={currentUserCompanyName || ''}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-bold uppercase text-secondary mb-1">Machine Name</label>
                    <select
                      className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                      value={isEmployee ? userMachine : (isCustomMachineEdit ? "Other" : (editingEmployee.machineName || ''))}
                      disabled={isEmployee}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === "Other") {
                          setIsCustomMachineEdit(true);
                          setEditingEmployee(prev => prev ? { ...prev, machineName: '' } : null);
                        } else {
                          setIsCustomMachineEdit(false);
                          setEditingEmployee(prev => prev ? { ...prev, machineName: val } : null);
                        }
                      }}
                      required
                    >
                      <option value="">Select Machine</option>
                      {Array.from(new Set([...machinesList, ...customMachines])).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {!isEmployee && <option value="Other">Other (Type custom...)</option>}
                    </select>
                  </div>
                  {isCustomMachineEdit && !isEmployee && (
                    <div>
                      <label className="block text-xs font-bold uppercase text-secondary mb-1">Custom Machine Name</label>
                      <input
                        type="text"
                        className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                        value={customMachineEditInput}
                        onChange={e => {
                          setCustomMachineEditInput(e.target.value);
                          setEditingEmployee(prev => prev ? { ...prev, machineName: e.target.value } : null);
                        }}
                        placeholder="Type machine name..."
                        required
                      />
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold uppercase text-secondary mb-2">Employee Photo</label>
                    <div className="flex flex-col sm:flex-row items-center gap-4 bg-surface-container-lowest p-4 rounded-xl border border-outline/10">
                      <div className="relative w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center overflow-hidden border-2 border-primary/20 shadow-md group">
                        {editingEmployee.photoUrl ? (
                          <>
                            <img src={editingEmployee.photoUrl} alt="Preview" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setEditingEmployee(prev => prev ? { ...prev, photoUrl: '' } : null)}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center text-outline">
                            <Camera size={28} className="text-secondary/60" />
                            <span className="text-[10px] font-black uppercase tracking-wider mt-1">No Photo</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 w-full">
                        <div className="relative border-2 border-dashed border-outline-variant/30 hover:border-primary/50 rounded-xl p-4 text-center cursor-pointer transition-all bg-surface-container-low hover:bg-surface-container-high flex flex-col items-center justify-center">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handlePhotoUpload(e, true)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <Upload size={20} className="text-primary mb-1.5" />
                          <p className="text-xs font-bold text-on-surface">Click or Drag Photo Here</p>
                          <p className="text-[10px] text-outline mt-1 font-semibold">PNG, JPG, WEBP (Auto-compressed to fit database)</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                {(!isEmployee || (isEmployee && currentUserAccessType === 'admin-light')) && (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50 space-y-2">
                    <label className="block text-xs font-black uppercase text-indigo-900 tracking-wider">Access Control</label>
                    <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                      Choose whether this employee has full administrative access or non-access (profile-only).
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="editAccessType"
                          value="full"
                          checked={editingEmployee.accessType === 'full'}
                          onChange={() => setEditingEmployee({ ...editingEmployee, accessType: 'full' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Full Access (Admin)
                        </span>
                      </label>
                      {!isEmployee && (
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <input
                            type="radio"
                            name="editAccessType"
                            value="admin-light"
                            checked={editingEmployee.accessType === 'admin-light'}
                            onChange={() => setEditingEmployee({ ...editingEmployee, accessType: 'admin-light' })}
                            className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                          />
                          <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                            Admin-light (Company Admin)
                          </span>
                        </label>
                      )}
                      <label className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="radio"
                          name="editAccessType"
                          value="limited"
                          checked={editingEmployee.accessType === 'limited'}
                          onChange={() => setEditingEmployee({ ...editingEmployee, accessType: 'limited' })}
                          className="w-4 h-4 text-indigo-900 border-slate-300 focus:ring-indigo-900"
                        />
                        <span className="text-xs font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">
                          Non-Access (Profile-only)
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {editingEmployee.accessType === 'admin-light' && (
                  <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/40 space-y-3">
                    <h3 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-1.5">
                      <Factory size={14} /> Company Settings (Required for Admin-light)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Name</label>
                        <input
                          type="text"
                          required={editingEmployee.accessType === 'admin-light'}
                          placeholder="e.g. Acme Corporation"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyName || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">GST Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 27AAAAA1111A1Z1"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyGst || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyGst: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Mobile</label>
                        <input
                          type="text"
                          placeholder="e.g. +91 9876543210"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyMobile || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyMobile: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Email</label>
                        <input
                          type="email"
                          placeholder="e.g. contact@acme.com"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyEmail || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyEmail: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Department Name</label>
                        <input
                          type="text"
                          placeholder="e.g. Engineering & IT"
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          value={editingEmployee.companyDept || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyDept: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase text-amber-800 mb-0.5">Company Address</label>
                        <textarea
                          placeholder="Full address of the company..."
                          className="w-full border border-amber-200/60 rounded px-2.5 py-1.5 text-xs bg-white h-12 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
                          value={editingEmployee.companyAddress || ''}
                          onChange={e => setEditingEmployee({ ...editingEmployee, companyAddress: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Address</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-20"
                    value={editingEmployee.address || ''}
                    onChange={e => setEditingEmployee({ ...editingEmployee, address: e.target.value })}
                  />
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

      {/* Check Employees of Company Modal */}
      <AnimatePresence>
        {selectedCompanyForView && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-100 text-amber-800 rounded-lg">
                    <Factory size={18} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 leading-tight">{selectedCompanyForView}</h2>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">All registered employees under this company</p>
                  </div>
                </div>
                <button onClick={() => setSelectedCompanyForView(null)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                      <th className="px-4 py-2.5">Photo</th>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Designation</th>
                      <th className="px-4 py-2.5">Access Type</th>
                      <th className="px-4 py-2.5">Mobile</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                    {employees.filter(emp => emp.companyName === selectedCompanyForView).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-medium">No employees found in this company.</td>
                      </tr>
                    ) : (
                      employees.filter(emp => emp.companyName === selectedCompanyForView).map(emp => (
                        <tr key={emp.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200/50">
                              {emp.photoUrl ? (
                                <img src={emp.photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-xs font-bold text-slate-400">{emp.name.charAt(0)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-bold text-slate-800">{emp.name}</div>
                            <div className="text-[10px] text-slate-400 font-medium">{emp.email}</div>
                          </td>
                          <td className="px-4 py-2 text-slate-600">{emp.designation}</td>
                          <td className="px-4 py-2">
                            {emp.accessType === 'full' && (
                              <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded">Admin</span>
                            )}
                            {emp.accessType === 'admin-light' && (
                              <span className="bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded">Admin-light</span>
                            )}
                            {(!emp.accessType || emp.accessType === 'limited') && (
                              <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded">Non-Access</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-500">{emp.mobile}</td>
                          <td className="px-4 py-2">
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                              emp.status === 'active' ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                            )}>
                              {emp.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedCompanyForView(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors active:scale-95"
                >
                  Close Directory
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Exit Modal */}
      <AnimatePresence>
        {showExitModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center">
                <h2 className="text-xl font-bold text-primary">Employee Exit</h2>
                <button onClick={() => setShowExitModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-on-surface-variant">
                  Are you sure you want to mark <strong>{selectedEmployee?.name}</strong> as left? This will move them to the "Leave Employee" section.
                </p>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Date of Exit</label>
                  <input
                    type="date"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={exitDate}
                    onChange={e => setExitDate(e.target.value)}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowExitModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExitEmployee}
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-red-700 hover:to-orange-700 transition-all transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Confirm Exit
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Company Modal */}
      <AnimatePresence>
        {showCreateCompanyModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-8"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-black text-slate-800">Create New Company</h2>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">Define corporate attributes and initial admin login credentials.</p>
                </div>
                <button onClick={() => setShowCreateCompanyModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleCreateCompanySubmit}>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  
                  {/* General Profile Info */}
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950">1. Company Profile</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Name <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Acme Corporation"
                          value={newCompanyData.name}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, name: e.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">GST Number <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold"
                          placeholder="e.g. 27AADCB2230F1ZT"
                          value={newCompanyData.gst}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, gst: e.target.value }))}
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Mobile Number</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. +91 9876543210"
                          value={newCompanyData.mobile}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, mobile: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Email Address</label>
                        <input
                          type="email"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. admin@acme.com"
                          value={newCompanyData.email}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, email: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Department Name</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Human Resources"
                          value={newCompanyData.dept}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, dept: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Address</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Suite 402, Business District"
                          value={newCompanyData.address}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, address: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Credentials Info */}
                  <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900">2. Initial Admin-Light Credentials</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Login ID <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold text-indigo-900"
                          placeholder="e.g. acme_admin"
                          value={newCompanyData.loginId}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, loginId: e.target.value }))}
                          required
                        />
                        <p className="text-[10px] text-indigo-600 font-medium mt-1">This ID is used for first-time login verification.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Initial Password <span className="text-red-500">*</span></label>
                        <input
                          type="password"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono text-indigo-900"
                          placeholder="••••••••"
                          value={newCompanyData.password}
                          onChange={e => setNewCompanyData(prev => ({ ...prev, password: e.target.value }))}
                          required
                        />
                        <p className="text-[10px] text-indigo-600 font-medium mt-1">The company admin will be prompted to change this upon login.</p>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCreateCompanyModal(false)}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-indigo-600/15 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Create & Provision
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {editingCompany && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl my-8"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-slate-50">
                <div>
                  <h2 className="text-xl font-black text-slate-800">Edit Company Profile</h2>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">Modify company attributes and administrator credentials.</p>
                </div>
                <button onClick={() => setEditingCompany(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleEditCompanySubmit}>
                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  
                  {/* General Profile Info */}
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-950">1. Company Profile</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Name <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Acme Corporation"
                          value={editingCompany.companyName || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyName: e.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">GST Number <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold"
                          placeholder="e.g. 27AADCB2230F1ZT"
                          value={editingCompany.companyGst || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyGst: e.target.value }))}
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Mobile Number</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. +91 9876543210"
                          value={editingCompany.mobile || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, mobile: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Email Address</label>
                        <input
                          type="email"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. admin@acme.com"
                          value={editingCompany.email || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, email: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Department Name</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Human Resources"
                          value={editingCompany.companyDept || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyDept: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Company Address</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-semibold"
                          placeholder="e.g. Suite 402, Business District"
                          value={editingCompany.companyAddress || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, companyAddress: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Credentials Info */}
                  <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900">2. Admin-Light Credentials</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Login ID <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono font-bold text-indigo-900"
                          placeholder="e.g. acme_admin"
                          value={editingCompany.loginId || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, loginId: e.target.value }))}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase text-indigo-700 mb-1">Password <span className="text-red-500">*</span></label>
                        <input
                          type="password"
                          className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-3 py-2 text-sm focus:outline-none bg-white font-mono text-indigo-900"
                          placeholder="••••••••"
                          value={editingCompany.password || ''}
                          onChange={e => setEditingCompany(prev => ({ ...prev, password: e.target.value }))}
                          required
                        />
                      </div>
                    </div>
                  </div>

                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingCompany(null)}
                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-indigo-600/15 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : null}
                    Save Company Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Details Modal */}
      <AnimatePresence>
        {showViewModal && selectedEmployee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary">Employee Details</h2>
                <button onClick={() => setShowViewModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <div className="p-8 max-h-[65vh] overflow-y-auto">
                <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                  <div className="w-32 h-32 rounded-2xl bg-surface-container-high flex items-center justify-center overflow-hidden shadow-inner border-2 border-outline-variant/20">
                    {selectedEmployee.photoUrl ? (
                      <img src={selectedEmployee.photoUrl} alt={selectedEmployee.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl font-black text-outline">{selectedEmployee.name.charAt(0)}</span>
                    )}
                  </div>
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-y-6 gap-x-12">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Full Name</label>
                      <p className="text-lg font-bold text-on-surface">{selectedEmployee.name}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Status</label>
                      <div>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                          selectedEmployee.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        )}>
                          {selectedEmployee.status}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Designation</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.designation}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Mobile</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.mobile}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Email</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.email}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Date of Joining</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.doj}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Date of Birth (DOB)</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.dob || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">
                        {selectedEmployee.accessType === 'admin-light' ? 'ID Number' : 'PF Number'}
                      </label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.pfNo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">
                        {selectedEmployee.accessType === 'admin-light' ? 'GST Number' : 'ESIC Number'}
                      </label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.esicNo || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Qualification</label>
                      <p className="text-sm font-bold text-on-surface-variant">{selectedEmployee.qualification || 'N/A'}</p>
                    </div>
                    {!isEmployee && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline">Access Control</label>
                        <p className="text-sm font-bold text-on-surface-variant">
                          {selectedEmployee.accessType === 'full' ? 'Full Access (Admin-like privileges)' : 'Non-Access (Profile-only, changes forward to Admin)'}
                        </p>
                      </div>
                    )}
                    {selectedEmployee.status === 'left' && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-outline">Date of Exit</label>
                        <p className="text-sm font-bold text-red-600">{selectedEmployee.doe}</p>
                      </div>
                    )}
                    <div className="md:col-span-2 space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-outline">Address</label>
                      <p className="text-sm text-on-surface-variant leading-relaxed">{selectedEmployee.address || 'No address provided'}</p>
                    </div>

                    {/* Career & Designation History (Promotions / Demotions) */}
                    {selectedEmployee.designationHistory && selectedEmployee.designationHistory.length > 0 && (
                      <div className="md:col-span-2 border-t border-slate-100 pt-5 mt-4 space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                          <TrendingUp size={14} className="text-indigo-600" /> Career & Designation History
                        </h4>
                        <div className="relative border-l-2 border-indigo-100 pl-4 ml-2 space-y-4">
                          {selectedEmployee.designationHistory.map((hist: any, hIdx: number) => (
                            <div key={hIdx} className="relative">
                              {/* Pulse point */}
                              <span className="absolute -left-[21px] top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-indigo-600 ring-4 ring-white" />
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-xs font-bold text-slate-800">
                                  {hist.oldDesignation} &rarr; <span className="text-indigo-700 font-extrabold">{hist.newDesignation}</span>
                                </span>
                                <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold">
                                  {hist.type?.toUpperCase() || 'UPDATE'} • {hist.updatedAt}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                Period: {hist.periodStart || 'N/A'} to {hist.periodEnd || 'N/A'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Previous Employment History */}
                    {selectedEmployee.employmentHistory && selectedEmployee.employmentHistory.length > 0 && (
                      <div className="md:col-span-2 border-t border-slate-100 pt-5 mt-4 space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                          <History size={14} className="text-amber-600" /> Previous Employment Records
                        </h4>
                        <div className="relative border-l-2 border-amber-100 pl-4 ml-2 space-y-4">
                          {selectedEmployee.employmentHistory.map((job: any, jIdx: number) => (
                            <div key={jIdx} className="relative">
                              {/* Pulse point */}
                              <span className="absolute -left-[21px] top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-amber-600 ring-4 ring-white" />
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                <span className="text-xs font-bold text-slate-800">
                                  Company: <span className="text-amber-800 font-extrabold">{job.companyName}</span>
                                </span>
                                <span className="text-[10px] font-mono bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-bold">
                                  {job.designation || 'Employee'}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                Duration: {job.doj || 'N/A'} to {job.leftDate || job.doe || 'N/A'} ({job.status || 'Left'})
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-6 bg-surface-container-low flex justify-end">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="px-8 py-2.5 bg-primary text-white text-sm font-black rounded-lg shadow-md hover:bg-indigo-800 transition-all active:scale-95"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Notification Modal */}
      <AnimatePresence>
        {showNotificationModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary">Create Announcement Notification</h2>
                <button onClick={() => setShowNotificationModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleCreateNotification} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Target Audience</label>
                  <select
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm bg-white"
                    value={notificationTarget}
                    onChange={e => setNotificationTarget(e.target.value)}
                  >
                    <option value="all">All Registered App Users</option>
                    {filteredEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.designation})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm"
                    value={notificationTitle}
                    onChange={e => setNotificationTitle(e.target.value)}
                    placeholder="e.g. System Announcement"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-secondary mb-1">Message Body</label>
                  <textarea
                    className="w-full border border-outline/20 rounded px-3 py-2 text-sm h-28"
                    value={notificationMessage}
                    onChange={e => setNotificationMessage(e.target.value)}
                    placeholder="Type the announcement details here..."
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowNotificationModal(false)}
                    className="px-4 py-2 text-sm font-bold text-secondary hover:bg-surface-container-low rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white text-sm font-bold rounded shadow-lg hover:from-amber-700 hover:to-orange-700 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={18} /> : null}
                    Send Broadcast
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* App Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low">
                <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                  <Settings size={22} className="text-indigo-600" /> App Settings
                </h2>
                <button onClick={() => setShowSettingsModal(false)} className="text-outline hover:text-on-surface">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                {currentUserAccessType !== 'admin-light' && (
                  <>
                    {/* 1. App Heading Settings */}
                    <form onSubmit={handleSaveAppTitle} className="space-y-3 pb-6 border-b border-slate-100">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-secondary">App Header Title</h3>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 border border-outline/20 rounded px-3 py-2 text-sm"
                          value={settingsAppTitle}
                          onChange={e => setSettingsAppTitle(e.target.value)}
                          placeholder="e.g. Active Engineers Railway"
                          required
                        />
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-sm transition-all shadow active:scale-95 disabled:opacity-50"
                        >
                          Save Title
                        </button>
                      </div>
                    </form>

                    {/* 3. Manage Footer Links Settings */}
                    <form onSubmit={handleSaveFooterLinks} className="space-y-4 pb-6 border-b border-slate-100">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-secondary">Manage Footer Links</h3>
                      
                      <div className="space-y-2.5">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Facebook Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsFbLink}
                            onChange={e => setSettingsFbLink(e.target.value)}
                            placeholder="e.g. https://www.facebook.com/..."
                          />
                        </div>
                        
                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Instagram Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsIgLink}
                            onChange={e => setSettingsIgLink(e.target.value)}
                            placeholder="e.g. https://www.instagram.com/..."
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Website Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsWebLink}
                            onChange={e => setSettingsWebLink(e.target.value)}
                            placeholder="e.g. https://example.com or #"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-slate-500 block mb-1">Telegram Link</label>
                          <input
                            type="text"
                            className="w-full border border-outline/20 rounded px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            value={settingsTgLink}
                            onChange={e => setSettingsTgLink(e.target.value)}
                            placeholder="e.g. https://t.me/..."
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold text-sm transition-all shadow active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {submitting && <Loader2 size={14} className="animate-spin" />}
                          Save Links
                        </button>
                      </div>
                    </form>
                  </>
                )}

                {/* 2. Machine Names Settings */}
                <div className="space-y-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-secondary">Manage Machine Names</h3>
                  
                  {/* Add Machine Form */}
                  <form onSubmit={handleAddMachine} className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 border border-outline/20 rounded px-3 py-2 text-sm"
                      value={newMachineInput}
                      onChange={e => setNewMachineInput(e.target.value)}
                      placeholder="Add new machine name..."
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white rounded font-bold text-sm transition-all shadow active:scale-95 flex items-center gap-1"
                    >
                      <Plus size={16} /> Add
                    </button>
                  </form>

                  {/* List of Machines */}
                  <div className="border border-outline/15 rounded-lg overflow-hidden bg-slate-50 max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {machinesList.length === 0 ? (
                      <p className="p-4 text-xs text-secondary text-center">No machine names configured.</p>
                    ) : (
                      machinesList.map((machine, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-white hover:bg-slate-50 transition-colors">
                          {editingMachineIndex === index ? (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="text"
                                className="flex-1 border border-outline/30 rounded px-2.5 py-1 text-sm bg-white"
                                value={editingMachineValue}
                                onChange={e => setEditingMachineValue(e.target.value)}
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleEditMachineSave(index)}
                                className="p-1.5 text-emerald-600 hover:text-emerald-700 transition-colors"
                                title="Save"
                              >
                                <Check size={18} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMachineIndex(null);
                                  setEditingMachineValue("");
                                }}
                                className="p-1.5 text-red-500 hover:text-red-600 transition-colors"
                                title="Cancel"
                              >
                                <X size={18} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-semibold text-slate-700">{machine}</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMachineIndex(index);
                                    setEditingMachineValue(machine);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
                                  title="Edit Machine Name"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMachine(index)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                                  title="Delete Machine"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-surface-container-low border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-lg transition-all active:scale-95"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
