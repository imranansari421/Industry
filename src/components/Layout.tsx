import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Package, ClipboardList, FileText, UserCircle, LogOut, Factory, Bell, CheckCheck, Trash2, X, MessageSquare, FolderOpen } from 'lucide-react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch, deleteDoc, getDocs } from 'firebase/firestore';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { findEmployeeForUser } from '../utils/employee';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/hr', label: 'HR', icon: Users },
  { path: '/catalog', label: 'Inventory', icon: Package },
  { path: '/demand', label: 'Demand', icon: ClipboardList },
  { path: '/issue', label: 'Issue', icon: FileText },
  { path: '/report', label: 'Report', icon: FileText },
  { path: '/messages', label: 'Messages', icon: MessageSquare },
  { path: '/todos', label: 'Folders', icon: FolderOpen },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [appTitle, setAppTitle] = useState(() => {
    return localStorage.getItem('appTitle') || "Active Engineers Railway";
  });

  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');
  const [accessType, setAccessType] = useState<string>(() => {
    return auth.currentUser ? localStorage.getItem(`accessType_${auth.currentUser.uid}`) || 'limited' : 'limited';
  });

  const isAdminOrFullAccess = !isEmployee || accessType === 'full';

  const filteredNavItems = navItems.filter((item) => {
    if (isEmployee && item.path === '/hr') {
      return accessType === 'full' || accessType === 'admin-light';
    }
    return true;
  });

  const fetchProfilePhoto = async () => {
    if (!auth.currentUser) return;
    try {
      const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
      if (emp) {
        if (emp.photoUrl) {
          setPhotoUrl(emp.photoUrl);
        }
        setAccessType(emp.accessType || 'limited');
        localStorage.setItem(`accessType_${auth.currentUser.uid}`, emp.accessType || 'limited');
      }
    } catch (error) {
      console.error('Error loading layout profile photo:', error);
    }
  };

  useEffect(() => {
    fetchProfilePhoto();

    const handleProfileUpdate = () => {
      fetchProfilePhoto();
    };

    window.addEventListener('profile-updated', handleProfileUpdate);
    return () => {
      window.removeEventListener('profile-updated', handleProfileUpdate);
    };
  }, []);

  useEffect(() => {
    const unsubscribeSettings = onSnapshot(doc(db, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.appTitle) {
          setAppTitle(data.appTitle);
          localStorage.setItem('appTitle', data.appTitle);
        }
      }
    }, (error) => {
      console.warn("Failed to listen to general settings in Layout:", error);
    });

    return () => unsubscribeSettings();
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;

    const syncNotifications = async () => {
      const user = auth.currentUser;
      if (!user || !user.email) return;

      try {
        // 1. Sync employee-specific notifications that are targeted to this user's email but don't have their uid set yet
        const pendingSnap = await getDocs(
          query(
            collection(db, 'notifications'),
            where('targetEmail', '==', user.email),
            where('uid', '==', '')
          )
        );

        if (!pendingSnap.empty) {
          const batch = writeBatch(db);
          pendingSnap.docs.forEach((docSnap) => {
            batch.update(doc(db, 'notifications', docSnap.id), {
              uid: user.uid
            });
          });
          await batch.commit();
        }

        // 2. Sync global/announcement notifications (target: 'all')
        const globalSnap = await getDocs(
          query(
            collection(db, 'notifications'),
            where('target', '==', 'all')
          )
        );

        if (!globalSnap.empty) {
          // Fetch existing user-specific notifications that have a parentId
          const userNotificationsSnap = await getDocs(
            query(
              collection(db, 'notifications'),
              where('uid', '==', user.uid)
            )
          );

          const existingParentIds = new Set(
            userNotificationsSnap.docs
              .map(doc => doc.data().parentId)
              .filter(Boolean)
          );

          const batch = writeBatch(db);
          let needsCommit = false;

          globalSnap.docs.forEach((docSnap) => {
            const data = docSnap.data();
            // If the user doesn't have a copy of this global notification yet
            if (!existingParentIds.has(docSnap.id)) {
              const newRef = doc(collection(db, 'notifications'));
              batch.set(newRef, {
                uid: user.uid,
                parentId: docSnap.id,
                title: data.title,
                message: data.message,
                createdAt: data.createdAt,
                read: false,
                type: data.type || 'announcement'
              });
              needsCommit = true;
            }
          });

          if (needsCommit) {
            await batch.commit();
          }
        }
      } catch (err) {
        console.error('Error syncing notifications for user:', err);
      }
    };

    syncNotifications();
  }, []);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'notifications'),
      where('uid', '==', auth.currentUser.uid)
    );

    const unsubscribeNotifications = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      list.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setNotifications(list);
    }, (error) => {
      console.error("Error listening to notifications:", error);
    });

    return () => {
      unsubscribeNotifications();
    };
  }, []);

  const handleMarkAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => {
        if (!n.read) {
          batch.update(doc(db, 'notifications', n.id), { read: true });
        }
      });
      await batch.commit();
    } catch (err) {
      console.error("Error marking all as read:", err);
    }
  };

  const handleClearNotification = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  };

  const handleClearAll = async () => {
    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => {
        batch.delete(doc(db, 'notifications', n.id));
      });
      await batch.commit();
    } catch (err) {
      console.error("Error clearing notifications:", err);
    }
  };

  const handleLogout = async () => {
    try {
      sessionStorage.clear();
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top App Bar */}
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="fixed top-0 w-full z-50 bg-slate-50 border-b border-slate-200/50 shadow-sm flex items-center justify-between px-6 h-16"
      >
        <div className="flex items-center gap-3">
          <Factory className="text-indigo-900" size={24} />
          <span className="text-xl font-bold tracking-tighter text-indigo-900">{appTitle}</span>
        </div>
        <div className="flex items-center gap-6 relative">
          
          {/* Notification Bell */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2 text-slate-500 hover:text-indigo-900 hover:bg-slate-100 rounded-full transition-colors relative"
              title="Notifications"
            >
              <Bell size={22} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full animate-bounce">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            <AnimatePresence>
              {showNotifications && (
                <>
                  {/* Backdrop close layer */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                  
                  <motion.div
                    initial={{ opacity: 0, y: 15, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 15, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50 flex flex-col max-h-[420px]"
                  >
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        Notifications
                        {unreadCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] rounded-full font-bold">
                            {unreadCount} new
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        {unreadCount > 0 && (
                          <button
                            onClick={handleMarkAllAsRead}
                            className="p-1.5 text-slate-400 hover:text-indigo-950 rounded hover:bg-slate-200 transition-colors"
                            title="Mark all as read"
                          >
                            <CheckCheck size={16} />
                          </button>
                        )}
                        {isAdminOrFullAccess && notifications.length > 0 && (
                          <button
                            onClick={handleClearAll}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-slate-200 transition-colors"
                            title="Clear all notifications"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setShowNotifications(false)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100 overflow-y-auto flex-grow">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => handleMarkAsRead(n.id)}
                          className={cn(
                            "p-4 cursor-pointer hover:bg-slate-50 transition-colors flex gap-3 relative group",
                            !n.read ? "bg-indigo-50/20" : ""
                          )}
                        >
                          <div className={cn(
                            "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                            !n.read ? "bg-indigo-600" : "bg-transparent"
                          )} />
                          <div className="flex-grow space-y-1">
                            <div className="flex items-center justify-between">
                              <span className={cn(
                                "text-xs font-bold",
                                n.type === 'approval' ? "text-emerald-700" :
                                n.type === 'rejection' ? "text-rose-700" : "text-slate-800"
                              )}>
                                {n.title}
                              </span>
                              <span className="text-[9px] font-medium text-slate-400">
                                {n.createdAt ? new Date(n.createdAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : ''}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-normal">{n.message}</p>
                          </div>
                          {isAdminOrFullAccess && (
                            <button
                              onClick={(e) => handleClearNotification(n.id, e)}
                              className="absolute right-2 bottom-2 p-1 text-slate-300 hover:text-red-500 rounded hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all"
                              title="Delete"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}

                      {notifications.length === 0 && (
                        <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                          <Bell size={32} className="text-slate-300 stroke-[1.5]" />
                          <p className="text-xs font-semibold">No notifications</p>
                          <p className="text-[10px]">We'll let you know when the admin reviews your profile.</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          <Link
            to="/profile"
            className="flex items-center gap-2 text-slate-500 hover:text-indigo-700 transition-colors group"
          >
            <motion.div 
              whileHover={{ scale: 1.1 }}
              className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden border border-slate-300/60"
            >
              {photoUrl ? (
                <img src={photoUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <UserCircle size={24} className="text-slate-400" />
              )}
            </motion.div>
            <span className="text-sm font-medium">Profile Settings</span>
          </Link>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleLogout}
            className="px-4 py-2 bg-indigo-900 text-white rounded-lg text-sm font-semibold transition-colors hover:bg-indigo-800"
          >
            Logout
          </motion.button>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="flex-grow pt-24 pb-24 px-6 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation Bar */}
      <motion.nav 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="fixed bottom-0 w-full z-50 rounded-t-lg bg-white/80 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] flex justify-around items-center h-20 px-4 pb-safe"
      >
        {filteredNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center py-1 px-3 transition-all relative",
                isActive
                  ? "text-indigo-900"
                  : "text-slate-500 hover:text-indigo-700"
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute inset-0 bg-indigo-50/50 rounded-md -z-10"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <motion.div
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.8 }}
              >
                <Icon size={24} />
              </motion.div>
              <span className="text-[11px] font-medium uppercase tracking-wider mt-1">{item.label}</span>
            </Link>
          );
        })}
      </motion.nav>
    </div>
  );
}
