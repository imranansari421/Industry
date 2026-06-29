import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { 
  UserCircle, Save, Mail, Phone, MapPin, Briefcase, 
  User as UserIcon, Loader2, Calendar, Award, 
  ShieldAlert, Edit3, X, Send, Camera, Upload, CheckCircle,
  Lock, KeyRound, TrendingUp, History, Building2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { findEmployeeForUser, EmployeeProfile, ProfileApprovalRequest } from '../utils/employee';

export default function Profile() {
  const [profile, setProfile] = useState<EmployeeProfile>({
    employeeId: '',
    name: '',
    mobile: '',
    email: '',
    designation: '',
    gender: 'Male',
    address: '',
    doj: '',
    dob: '',
    photoUrl: '',
    status: 'active',
    pfNo: '',
    esicNo: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEmployee, setIsEmployee] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<ProfileApprovalRequest | null>(null);
  const [authorities, setAuthorities] = useState<any[]>([]);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string>('');

  // Backup of the original profile to restore on Cancel
  const [originalProfile, setOriginalProfile] = useState<EmployeeProfile | null>(null);

  // States for PIN management
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [updatingPin, setUpdatingPin] = useState(false);

  // States for Password management (Company Admin / admin-light)
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) {
      toast.error('You must be logged in to update your password.');
      return;
    }
    if (!newPassword || !confirmNewPassword) {
      toast.error('Please fill in all password fields.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('New password and Confirm password do not match.');
      return;
    }

    setUpdatingPassword(true);
    try {
      if (profile.accessType === 'admin-light') {
        if (!oldPassword) {
          toast.error('Please enter your current password.');
          setUpdatingPassword(false);
          return;
        }
        if (oldPassword !== (profile as any).password) {
          toast.error('Incorrect current password.');
          setUpdatingPassword(false);
          return;
        }
        if (newPassword === oldPassword) {
          toast.error('New password cannot be the same as old password.');
          setUpdatingPassword(false);
          return;
        }

        const { doc, updateDoc } = await import('firebase/firestore');
        const empRef = doc(db, 'employees', profile.employeeId);
        await updateDoc(empRef, {
          password: newPassword
        });

        // Update local profile state
        setProfile(prev => ({ ...prev, password: newPassword } as any));
        if (originalProfile) {
          setOriginalProfile(prev => prev ? ({ ...prev, password: newPassword } as any) : null);
        }
        toast.success('Password changed successfully! Use your new password for future logins.');
      } else {
        // Master Admin
        const { updatePassword } = await import('firebase/auth');
        await updatePassword(auth.currentUser, newPassword);
        toast.success('Admin password updated successfully in system security!');
      }

      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error: any) {
      console.error('Error updating password:', error);
      if (error.code === 'auth/requires-recent-login') {
        toast.error('For security reasons, this operation requires recent authentication. Please log out, log in again, and retry.');
      } else {
        toast.error('Failed to change password. Please try again.');
      }
    } finally {
      setUpdatingPassword(false);
    }
  };

  const fetchProfile = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const isEmpSession = auth.currentUser.email?.endsWith('@employee.billedapp.com') || false;
      setIsEmployee(isEmpSession);

      // Fetch the employee details using our robust helper
      const empProfile = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      
      if (empProfile) {
        setProfile(empProfile);
        setOriginalProfile(empProfile);
        
        // Fetch any pending request for this employee
        if (empProfile.employeeId) {
          await fetchPendingRequest(empProfile.employeeId);
        }

        // Fetch authorities (Full Access Admins) for their machine
        if (empProfile.accessType === 'admin-light') {
          setAuthorities([{ id: 'admin', name: 'Admin', designation: 'Top-Level Admin' }]);
          setSelectedAuthorityId('admin');
        } else if (empProfile.machineName) {
          try {
            const authQuery = query(
              collection(db, 'employees'),
              where('accessType', '==', 'full'),
              where('machineName', '==', empProfile.machineName)
            );
            const authSnap = await getDocs(authQuery);
            const authList = authSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAuthorities(authList);
            if (authList.length > 0) {
              setSelectedAuthorityId(authList[0].id);
            }
          } catch (err) {
            console.error('Error fetching section authorities:', err);
          }
        }
      } else {
        // Fallback for Admin / regular users
        const docRef = doc(db, 'users', auth.currentUser.uid);
        const docSnap = await getDoc(docRef);
        const basicProfile: EmployeeProfile = {
          employeeId: '',
          name: auth.currentUser.displayName || '',
          email: auth.currentUser.email || '',
          mobile: '',
          designation: 'Administrator',
          gender: 'Male',
          address: '',
          doj: '',
          dob: '',
          photoUrl: '',
          status: 'active',
          pfNo: '',
          esicNo: '',
        };

        if (docSnap.exists()) {
          const data = docSnap.data();
          const merged = { ...basicProfile, ...data } as EmployeeProfile;
          setProfile(merged);
          setOriginalProfile(merged);
        } else {
          setProfile(basicProfile);
          setOriginalProfile(basicProfile);
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast.error('Failed to load profile details.');
      handleFirestoreError(error, OperationType.GET, auth.currentUser ? `users/${auth.currentUser.uid}` : 'users');
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingRequest = async (employeeId: string) => {
    try {
      if (!auth.currentUser) return;
      const q = query(
        collection(db, 'profile_requests'),
        where('uid', '==', auth.currentUser.uid)
      );
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        const reqList = querySnapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as ProfileApprovalRequest))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const latest = reqList[0];
        if (latest.status === 'pending' || latest.status === 'returned') {
          setPendingRequest(latest);
        } else {
          setPendingRequest(null);
        }
      } else {
        setPendingRequest(null);
      }
    } catch (error) {
      console.error('Error fetching pending profile requests:', error);
      handleFirestoreError(error, OperationType.LIST, 'profile_requests');
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
            width = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
          setProfile(prev => ({ ...prev, photoUrl: compressedBase64 }));
          toast.success('Photo updated in form. Remember to submit for approval/save changes.');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCancel = () => {
    if (originalProfile) {
      setProfile(originalProfile);
    }
    setIsEditing(false);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    setSaving(true);

    try {
      if (isEmployee) {
        // Forwarding to Admin for Approval
        if (!profile.employeeId) {
          toast.error('Unable to find associated employee record to request changes.');
          setSaving(false);
          return;
        }

        if (pendingRequest && pendingRequest.status === 'pending') {
          toast.error('You already have a pending profile update request waiting for Admin approval.');
          setSaving(false);
          return;
        }

        const isFullAccessAdmin = profile.accessType === 'full';

        if (!isFullAccessAdmin && authorities.length > 0 && !selectedAuthorityId) {
          toast.error('Please select a Section Authority (Full Access Admin) to forward your request to.');
          setSaving(false);
          return;
        }

        const selectedAuthority = isFullAccessAdmin ? null : authorities.find(a => a.id === selectedAuthorityId);

        await addDoc(collection(db, 'profile_requests'), {
          employeeId: profile.employeeId,
          uid: auth.currentUser.uid,
          name: profile.name,
          email: profile.email,
          mobile: profile.mobile,
          designation: profile.designation,
          gender: profile.gender || 'Male',
          address: profile.address,
          dob: profile.dob || '',
          pfNo: profile.pfNo || '',
          esicNo: profile.esicNo || '',
          doj: profile.doj || '',
          photoUrl: profile.photoUrl || '',
          status: 'pending',
          authorityId: selectedAuthorityId || '',
          authorityName: selectedAuthorityId === 'admin' ? 'Admin' : (selectedAuthority ? selectedAuthority.name : ''),
          machineName: profile.machineName || '',
          forwardedToAdmin: selectedAuthorityId === 'admin',
          isFullAccessAdmin: isFullAccessAdmin,
          companyName: profile.companyName || '',
          forwardedToCompanyAdmin: isFullAccessAdmin, // Directly route to Company Admin-light
          createdAt: new Date().toISOString()
        });

        if (isFullAccessAdmin) {
          toast.success('Your profile changes have been forwarded directly to your Company Admin!');
        } else if (selectedAuthorityId === 'admin') {
          toast.success('Your profile changes have been forwarded directly to the Master Admin!');
        } else {
          toast.success('Your profile changes have been forwarded to the selected Section Authority!');
        }
        setIsEditing(false);
        await fetchPendingRequest(profile.employeeId);
      } else {
        // Direct save for Administrator
        await setDoc(doc(db, 'users', auth.currentUser.uid), {
          uid: auth.currentUser.uid,
          name: profile.name,
          email: profile.email,
          mobile: profile.mobile,
          designation: profile.designation,
          gender: profile.gender || 'Male',
          address: profile.address,
          role: 'admin',
        }, { merge: true });

        // Dispatch updated event for Layout header
        window.dispatchEvent(new Event('profile-updated'));

        toast.success('Administrator profile updated successfully!');
        setIsEditing(false);
        if (originalProfile) {
          setOriginalProfile({ ...profile });
        }
      }
    } catch (error) {
      console.error('Error submitting profile:', error);
      toast.error('Failed to update profile. Please check your credentials.');
      handleFirestoreError(error, OperationType.WRITE, isEmployee ? 'profile_requests' : `users/${auth.currentUser?.uid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.employeeId) {
      toast.error('No employee profile associated with this account.');
      return;
    }
    if (!oldPin || !newPin || !confirmNewPin) {
      toast.error('Please fill in all security PIN fields.');
      return;
    }
    if (oldPin !== profile.pin) {
      toast.error('Incorrect current PIN code.');
      return;
    }
    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
      toast.error('New PIN must be exactly 6 digits.');
      return;
    }
    if (newPin !== confirmNewPin) {
      toast.error('New PIN and Confirm PIN do not match.');
      return;
    }
    if (newPin === oldPin) {
      toast.error('New PIN cannot be the same as your old PIN.');
      return;
    }

    setUpdatingPin(true);
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const empRef = doc(db, 'employees', profile.employeeId);
      await updateDoc(empRef, {
        pin: newPin,
        isPinCreated: true
      });

      // Update local profile state
      setProfile(prev => ({ ...prev, pin: newPin }));
      if (originalProfile) {
        setOriginalProfile(prev => prev ? { ...prev, pin: newPin } : null);
      }

      toast.success('Security PIN changed successfully! Use your new PIN for future logins.');
      setOldPin('');
      setNewPin('');
      setConfirmNewPin('');
    } catch (error) {
      console.error('Error updating PIN:', error);
      toast.error('Failed to change PIN. Please try again.');
    } finally {
      setUpdatingPin(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"
        ></motion.div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      {/* Header section */}
      <section className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 p-6 rounded-2xl border border-slate-200/40">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-full bg-slate-200 border-2 border-indigo-100 flex items-center justify-center overflow-hidden shadow-inner relative group">
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.name} className="w-full h-full object-cover" />
            ) : (
              <UserCircle size={54} className="text-slate-400" />
            )}
            {isEditing && (
              <label className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white text-[9px] font-black uppercase tracking-wider cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={16} className="mb-0.5" />
                <span>Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none">{profile.name}</h1>
            <p className="text-slate-500 text-xs mt-1.5 font-bold uppercase tracking-widest flex items-center gap-1.5">
              <Award size={14} className="text-indigo-600" />
              {profile.designation} {isEmployee ? `(Employee - ${profile.companyName || 'No Company'})` : '(Admin)'}
            </p>
          </div>
        </div>

        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 bg-white hover:bg-slate-50 text-indigo-900 border border-slate-200 px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all transform hover:scale-[1.02] active:scale-95"
          >
            <Edit3 size={16} />
            <span>Edit Profile</span>
          </button>
        )}
      </section>

      {/* Pending Request Status Badge */}
      <AnimatePresence>
        {pendingRequest && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={cn(
              "border p-5 rounded-2xl flex items-start gap-4 shadow-sm",
              pendingRequest.status === 'returned' 
                ? "bg-rose-50 border-rose-200 text-rose-800" 
                : "bg-amber-50 border-amber-200/70 text-amber-800"
            )}
          >
            <ShieldAlert className={pendingRequest.status === 'returned' ? "text-rose-600 shrink-0 mt-0.5" : "text-amber-600 shrink-0 mt-0.5"} size={20} />
            <div className="text-xs font-bold uppercase tracking-widest space-y-1.5 leading-relaxed">
              <div className={cn("text-sm font-black", pendingRequest.status === 'returned' ? "text-rose-900" : "text-amber-900")}>
                {pendingRequest.status === 'returned' ? 'Returned by Section Authority' : 'Pending Approval'}
              </div>
              <div>
                {pendingRequest.status === 'returned' 
                  ? `Your profile update request was returned by ${pendingRequest.authorityName || 'Section Authority'} for corrections. Please review and re-submit.` 
                  : `Your profile update request was forwarded to ${pendingRequest.authorityName || 'Section Authority'} and is pending review.`
                }
              </div>
              {pendingRequest.remarks && (
                <div className={cn("px-3 py-2 rounded-lg border font-semibold mt-1 normal-case", pendingRequest.status === 'returned' ? "bg-rose-100/40 border-rose-200 text-rose-900" : "bg-amber-100/40 border-amber-200 text-amber-900")}>
                  Reason: <span className="font-normal">{pendingRequest.remarks}</span>
                </div>
              )}
              <div className={pendingRequest.status === 'returned' ? "text-[10px] text-rose-500" : "text-[10px] text-amber-600"}>
                Submitted on: {new Date(pendingRequest.createdAt).toLocaleDateString()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
      >
        <form onSubmit={handleFormSubmit} className="p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* Full Name */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <UserIcon size={14} className="text-slate-400" /> Full Name
              </label>
              <input
                type="text"
                disabled={!isEditing}
                className={cn(
                  "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                  !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                )}
                value={profile.name}
                onChange={e => setProfile({ ...profile, name: e.target.value })}
                required
              />
            </div>

            {/* Email Address */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Mail size={14} className="text-slate-400" /> Email Address
              </label>
              <input
                type="email"
                className="w-full border border-slate-200/40 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-500 bg-slate-50/70 cursor-not-allowed outline-none"
                value={profile.email}
                disabled
              />
            </div>

            {/* Mobile Number */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Phone size={14} className="text-slate-400" /> Mobile Number
              </label>
              <input
                type="text"
                disabled={!isEditing}
                className={cn(
                  "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                  !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                )}
                value={profile.mobile}
                onChange={e => setProfile({ ...profile, mobile: e.target.value })}
                required
              />
            </div>

            {/* Designation */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <Briefcase size={14} className="text-slate-400" /> Designation
              </label>
              <input
                type="text"
                disabled={!isEditing || isEmployee} // Employees designation is set by HR/Admin usually
                className={cn(
                  "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                  (!isEditing || isEmployee) && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                )}
                value={profile.designation}
                onChange={e => setProfile({ ...profile, designation: e.target.value })}
              />
            </div>

            {/* Company Name */}
            {isEmployee && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Building2 size={14} className="text-slate-400" /> Company Name
                </label>
                <input
                  type="text"
                  disabled
                  className="w-full border border-slate-200/40 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-500 bg-slate-50/70 cursor-not-allowed outline-none"
                  value={profile.companyName || 'Not Set'}
                />
              </div>
            )}

            {/* Gender */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <UserIcon size={14} className="text-slate-400" /> Gender
              </label>
              <select
                disabled={!isEditing}
                className={cn(
                  "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                  !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                )}
                value={profile.gender || 'Male'}
                onChange={e => setProfile({ ...profile, gender: e.target.value as any })}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Employee Specific: DOB */}
            {isEmployee && profile.accessType !== 'admin-light' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Calendar size={14} className="text-slate-400" /> Date of Birth (DOB)
                </label>
                <input
                  type="date"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.dob || ''}
                  onChange={e => setProfile({ ...profile, dob: e.target.value })}
                  required
                />
              </div>
            )}

            {/* Employee Specific: Date of Joining */}
            {isEmployee && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Calendar size={14} className="text-slate-400" /> Date of Joining (DOJ)
                </label>
                <input
                  type="date"
                  disabled={!isEditing}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.doj || ''}
                  onChange={e => setProfile({ ...profile, doj: e.target.value })}
                  required
                />
              </div>
            )}

            {/* Employee Specific: PF Number */}
            {isEmployee && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Award size={14} className="text-slate-400" /> {profile.accessType === 'admin-light' ? 'ID No.' : 'PF Number'}
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder={profile.accessType === 'admin-light' ? 'e.g. ID-12345' : 'MH/BAN/12345/678'}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.pfNo || ''}
                  onChange={e => setProfile({ ...profile, pfNo: e.target.value })}
                />
              </div>
            )}

            {/* Employee Specific: ESIC Number */}
            {isEmployee && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Award size={14} className="text-slate-400" /> {profile.accessType === 'admin-light' ? 'GST No.' : 'ESIC Number'}
                </label>
                <input
                  type="text"
                  disabled={!isEditing}
                  placeholder={profile.accessType === 'admin-light' ? 'e.g. 27AAAAA1111A1Z1' : '31000123450001001'}
                  className={cn(
                    "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all",
                    !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                  )}
                  value={profile.esicNo || ''}
                  onChange={e => setProfile({ ...profile, esicNo: e.target.value })}
                />
              </div>
            )}

            {/* Residential Address */}
            <div className="space-y-2 md:col-span-2">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <MapPin size={14} className="text-slate-400" /> Residential Address
              </label>
              <textarea
                disabled={!isEditing}
                className={cn(
                  "w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all h-24 resize-none",
                  !isEditing && "opacity-75 bg-slate-50 cursor-not-allowed border-slate-200/40"
                )}
                value={profile.address}
                onChange={e => setProfile({ ...profile, address: e.target.value })}
              />
            </div>

            {/* Employee Specific: Section Authority */}
            {isEmployee && isEditing && profile.accessType !== 'full' && (
              <div className="space-y-2 md:col-span-2 bg-indigo-5/40 border border-indigo-100/60 rounded-2xl p-4">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-900">
                  <UserIcon size={14} className="text-indigo-600" /> {profile.accessType === 'admin-light' ? 'Destination Authority' : 'Select Section Authority (Full Access Admin)'}
                </label>
                <select
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all mt-1"
                  value={selectedAuthorityId}
                  onChange={e => setSelectedAuthorityId(e.target.value)}
                  required
                >
                  {authorities.length === 0 ? (
                    <option value="">No Full Access Admin configured for this machine ({profile.machineName || 'General'})</option>
                  ) : (
                    authorities.map(authEmp => (
                      <option key={authEmp.id} value={authEmp.id}>
                        {authEmp.name} ({authEmp.designation})
                      </option>
                    ))
                  )}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  {profile.accessType === 'admin-light' 
                    ? "Your request will be sent directly to the Top-Level Admin for review and approval."
                    : `Your request will be sent to the selected Section Authority of your machine (${profile.machineName || 'General'}) for review and approval.`
                  }
                </p>
              </div>
            )}

            {/* Full Access Admin specific message */}
            {isEmployee && isEditing && profile.accessType === 'full' && (
              <div className="space-y-1 md:col-span-2 bg-indigo-50/50 border border-indigo-100/60 rounded-2xl p-4">
                <p className="text-xs font-bold text-indigo-900 flex items-center gap-2">
                  <UserIcon size={16} className="text-indigo-600" /> Direct Corporate Routing
                </p>
                <p className="text-[11px] text-slate-500 font-semibold">
                  As a Full Access Admin, your profile update requests will be forwarded directly to your Company Admin ({profile.companyName || 'Not Set'}) for review.
                </p>
              </div>
            )}
          </div>

          {/* Career & Designation History (Read-only) */}
          {isEmployee && profile.designationHistory && profile.designationHistory.length > 0 && (
            <div className="border-t border-slate-100 pt-6 mt-6 space-y-3">
              <h3 className="text-xs font-black uppercase text-indigo-900 tracking-wider flex items-center gap-2">
                <TrendingUp size={16} className="text-indigo-600" /> Career & Designation History
              </h3>
              <div className="relative pl-6 border-l-2 border-indigo-100 space-y-4 ml-2 pt-1">
                {profile.designationHistory.map((history, hIdx) => (
                  <div key={hIdx} className="relative">
                    {/* Timeline Dot */}
                    <div className="absolute -left-[31px] top-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow" />
                    <div className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/40">
                      <div className="flex justify-between items-start gap-4">
                        <span className="font-bold text-xs text-slate-800">
                          {history.oldDesignation} ➡️ {history.newDesignation}
                        </span>
                        <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                          {history.type}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 font-medium mt-1">
                        Changed On: <span className="font-semibold text-slate-700">{history.updatedAt ? new Date(history.updatedAt).toLocaleDateString() : 'N/A'}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Previous Employment History (Read-only) */}
          {isEmployee && profile.employmentHistory && profile.employmentHistory.length > 0 && (
            <div className="border-t border-slate-100 pt-6 mt-6 space-y-3">
              <h3 className="text-xs font-black uppercase text-amber-900 tracking-wider flex items-center gap-2">
                <History size={16} className="text-amber-600" /> Previous Employment Records (PF-Matched)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {profile.employmentHistory.map((history, hIdx) => (
                  <div key={hIdx} className="bg-amber-50/40 p-3.5 rounded-xl border border-amber-200/30 flex justify-between items-center">
                    <div>
                      <p className="text-xs font-black text-amber-900">{history.companyName}</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">{history.designation}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] bg-amber-100/60 border border-amber-200/50 text-amber-900 px-2 py-0.5 rounded-md font-bold block mb-1">
                        Left
                      </span>
                      <p className="text-[10px] text-slate-500 font-medium">
                        {history.doj} to {history.leftDate}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Form Actions */}
          <AnimatePresence>
            {isEditing && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-6 border-t border-slate-100 flex justify-end gap-3"
              >
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-sm transition-all flex items-center gap-2"
                >
                  <X size={16} />
                  <span>Cancel</span>
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={cn(
                    "bg-gradient-to-r text-white font-bold py-3 px-8 rounded-xl text-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
                    isEmployee ? "from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700" : "from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                  )}
                >
                  {saving ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : isEmployee ? (
                    <Send size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  <span>
                    {saving 
                      ? 'Processing...' 
                      : isEmployee 
                        ? 'Forward' 
                        : 'Save Profile Changes'
                    }
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </motion.div>

      {/* Credentials / Security section */}
      {(profile.accessType === 'admin-light' || !isEmployee) ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
        >
          <div className="border-b border-slate-100 p-6 bg-slate-50/50">
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <KeyRound className="text-indigo-600" size={20} /> {profile.accessType === 'admin-light' ? 'Change Corporate Admin Password' : 'Change Admin Password'}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Keep your account secure by periodically updating your credentials.
            </p>
          </div>

          <form onSubmit={handleUpdatePassword} className="p-8 space-y-6">
            <div className={cn(
              "grid grid-cols-1 gap-6",
              profile.accessType === 'admin-light' ? "sm:grid-cols-3" : "sm:grid-cols-2"
            )}>
              {/* Old Password */}
              {profile.accessType === 'admin-light' && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <Lock size={14} className="text-slate-400" /> Current Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                    value={oldPassword}
                    onChange={e => setOldPassword(e.target.value)}
                    required
                    id="old-password-input"
                  />
                </div>
              )}

              {/* New Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <KeyRound size={14} className="text-slate-400" /> New Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  id="new-password-input"
                />
              </div>

              {/* Confirm New Password */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <CheckCircle size={14} className="text-slate-400" /> Confirm New Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  required
                  id="confirm-password-input"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={updatingPassword}
                className="bg-indigo-900 hover:bg-indigo-800 text-white font-bold py-3.5 px-8 rounded-xl text-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50"
                id="update-password-btn"
              >
                {updatingPassword ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                <span>{profile.accessType === 'admin-light' ? 'Update Corporate Password' : 'Update Admin Password'}</span>
              </button>
            </div>
          </form>
        </motion.div>
      ) : isEmployee ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden"
        >
          <div className="border-b border-slate-100 p-6 bg-slate-50/50">
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <KeyRound className="text-indigo-600" size={20} /> Change Security PIN
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Keep your account secure by periodically updating your 6-digit access PIN.
            </p>
          </div>

          <form onSubmit={handleUpdatePin} className="p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Old PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <Lock size={14} className="text-slate-400" /> Current PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={oldPin}
                  onChange={e => setOldPin(e.target.value.replace(/\D/g, ''))}
                  required
                  id="current-pin-input"
                />
              </div>

              {/* New PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <KeyRound size={14} className="text-slate-400" /> New PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                  required
                  id="new-pin-input"
                />
              </div>

              {/* Confirm New PIN */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <CheckCircle size={14} className="text-slate-400" /> Confirm New PIN
                </label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d*"
                  placeholder="••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-slate-800 bg-slate-50/50 focus:bg-white focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 outline-none transition-all placeholder:text-slate-300"
                  value={confirmNewPin}
                  onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, ''))}
                  required
                  id="confirm-pin-input"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={updatingPin}
                className="bg-indigo-900 hover:bg-indigo-800 text-white font-bold py-3.5 px-8 rounded-xl text-sm transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-indigo-600/10 flex items-center justify-center gap-2 disabled:opacity-50"
                id="update-pin-btn"
              >
                {updatingPin ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <KeyRound size={16} />
                )}
                <span>Update Security PIN</span>
              </button>
            </div>
          </form>
        </motion.div>
      ) : null}
    </motion.div>
  );
}
