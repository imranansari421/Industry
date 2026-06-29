import React, { useEffect, useState } from 'react';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { findEmployeeForUser } from '../utils/employee';
import { Folder as FolderIcon, Plus, Trash2, Edit2, CheckCircle, Circle, Save, X, Calendar, ClipboardList, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';

interface TodoItem {
  id: string;
  task: string;
  completed: boolean;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

interface Folder {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export default function Folders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newTaskText, setNewTaskText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editing states
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState('');

  // Custom delete confirmation states
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  // Role details
  const [userRole, setUserRole] = useState<'admin' | 'admin-light' | 'full' | 'limited'>('limited');
  const [userName, setUserName] = useState('');
  const isEmployee = auth.currentUser?.email?.endsWith('@employee.billedapp.com');

  useEffect(() => {
    const fetchUserRoleAndData = async () => {
      if (!auth.currentUser) return;
      try {
        setUserName(auth.currentUser.displayName || auth.currentUser.email || 'Anonymous');
        if (!isEmployee) {
          setUserRole('admin');
        } else {
          const emp = await findEmployeeForUser(auth.currentUser.uid, auth.currentUser.email);
          if (emp) {
            setUserRole((emp.accessType as any) || 'limited');
            setUserName(emp.name || auth.currentUser.displayName || 'Employee');
          }
        }
      } catch (err) {
        console.error('Error fetching user info in Folders:', err);
      }
    };
    fetchUserRoleAndData();
  }, [isEmployee]);

  // Admin check (allows create, edit, delete operations for folders and todo items)
  const isAdmin = !isEmployee || userRole === 'admin' || userRole === 'full';

  // Sync folders
  useEffect(() => {
    const q = collection(db, 'folders');
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Folder))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setFolders(list);
      if (list.length > 0 && !selectedFolderId) {
        setSelectedFolderId(list[0].id);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'folders');
    });
    return () => unsub();
  }, [selectedFolderId]);

  // Sync todos for selected folder
  useEffect(() => {
    if (!selectedFolderId) {
      setTodos([]);
      return;
    }
    const q = query(collection(db, 'todos'), where('folderId', '==', selectedFolderId));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TodoItem))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setTodos(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `todos?folderId=${selectedFolderId}`);
    });
    return () => unsub();
  }, [selectedFolderId]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast.error('Only Admins have permission to create folders.');
      return;
    }
    if (!newFolderName.trim()) {
      toast.error('Folder name cannot be empty.');
      return;
    }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, 'folders'), {
        name: newFolderName.trim(),
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || '',
        createdByName: userName
      });
      setSelectedFolderId(docRef.id);
      setNewFolderName('');
      toast.success('Folder created successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'folders');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFolderId) {
      toast.error('Please select or create a folder first.');
      return;
    }
    if (!newTaskText.trim()) {
      toast.error('Task description cannot be empty.');
      return;
    }

    try {
      await addDoc(collection(db, 'todos'), {
        folderId: selectedFolderId,
        task: newTaskText.trim(),
        completed: false,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || '',
        createdByName: userName
      });
      setNewTaskText('');
      toast.success('Task added to list!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'todos');
    }
  };

  const handleToggleTask = async (todoId: string, currentCompleted: boolean) => {
    const todo = todos.find(t => t.id === todoId);
    const isCreator = todo?.createdBy === auth.currentUser?.uid;
    if (!isAdmin && !isCreator) {
      toast.error('You do not have permission to change this task.');
      return;
    }
    try {
      const ref = doc(db, 'todos', todoId);
      await updateDoc(ref, {
        completed: !currentCompleted
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `todos/${todoId}`);
    }
  };

  const handleSaveTaskEdit = async (todoId: string) => {
    const todo = todos.find(t => t.id === todoId);
    const isCreator = todo?.createdBy === auth.currentUser?.uid;
    if (!isAdmin && !isCreator) {
      toast.error('You do not have permission to edit this task.');
      return;
    }
    if (!editingTaskText.trim()) {
      toast.error('Task text cannot be empty.');
      return;
    }
    try {
      const ref = doc(db, 'todos', todoId);
      await updateDoc(ref, {
        task: editingTaskText.trim()
      });
      setEditingTaskId(null);
      setEditingTaskText('');
      toast.success('Task updated.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `todos/${todoId}`);
    }
  };

  const handleDeleteTask = async (todoId: string) => {
    const todo = todos.find(t => t.id === todoId);
    const isCreator = todo?.createdBy === auth.currentUser?.uid;
    if (!isAdmin && !isCreator) {
      toast.error('You do not have permission to delete this task.');
      return;
    }
    try {
      await deleteDoc(doc(db, 'todos', todoId));
      toast.success('Task deleted successfully.');
      setTaskToDelete(null);
    } catch (error) {
      toast.error('Failed to delete task.');
      handleFirestoreError(error, OperationType.DELETE, `todos/${todoId}`);
    }
  };

  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!isAdmin) {
      toast.error('Only Admins have permission to delete folders.');
      return;
    }
    setSaving(true);
    try {
      // Delete all tasks in the folder first
      let tasksSnap;
      try {
        tasksSnap = await getDocs(query(collection(db, 'todos'), where('folderId', '==', folderId)));
      } catch (err) {
        console.error('Error fetching tasks for folder:', err);
      }
      if (tasksSnap && tasksSnap.docs) {
        for (const d of tasksSnap.docs) {
          try {
            await deleteDoc(doc(db, 'todos', d.id));
          } catch (err) {
            console.error(`Error deleting task ${d.id}:`, err);
          }
        }
      }
      // Delete folder
      await deleteDoc(doc(db, 'folders', folderId));
      
      // Select another folder if available
      const remainingFolders = folders.filter(f => f.id !== folderId);
      if (remainingFolders.length > 0) {
        setSelectedFolderId(remainingFolders[0].id);
      } else {
        setSelectedFolderId('');
      }
      
      toast.success(`Folder "${folderName}" deleted successfully.`);
      setFolderToDelete(null);
    } catch (error) {
      console.error('Error deleting folder:', error);
      toast.error('Failed to delete folder.');
      handleFirestoreError(error, OperationType.DELETE, `folders/${folderId}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const activeFolder = folders.find(f => f.id === selectedFolderId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none">Folders & To-Do Lists</h1>
        <p className="text-xs text-slate-500 font-semibold mt-1">
          Create general task folders to organize workloads. 
          {isAdmin ? " You are authorized to manage folders." : " Read-only access to folder configuration."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Side: Folder Manager */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-slate-200/75 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <FolderIcon size={18} className="text-indigo-600" /> Task Folders
            </h2>

            {isAdmin && (
              <form onSubmit={handleCreateFolder} className="flex gap-2">
                <input
                  type="text"
                  placeholder="New folder name..."
                  className="flex-1 text-xs border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  maxLength={40}
                  required
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-3 py-2 text-xs font-bold transition-colors shadow flex items-center gap-1 shrink-0"
                >
                  <Plus size={14} /> Create
                </button>
              </form>
            )}

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {folders.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-6">No folders created yet.</p>
              ) : (
                folders.map(folder => {
                  const isActive = folder.id === selectedFolderId;
                  return (
                    <div
                      key={folder.id}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                        isActive
                          ? 'bg-indigo-50/70 border-indigo-200/80 text-indigo-900 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                      onClick={() => setSelectedFolderId(folder.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderIcon size={16} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
                        <span className="truncate">{folder.name}</span>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setFolderToDelete({ id: folder.id, name: folder.name });
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                          title="Delete Folder"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Side: To-Do Items inside selected Folder */}
        <div className="lg:col-span-8 space-y-6">
          {activeFolder ? (
            <div className="bg-white border border-slate-200/75 rounded-2xl p-6 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-lg font-black text-slate-800 leading-tight">
                    {activeFolder.name}
                  </h2>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5 uppercase tracking-wide">
                    Created by: {activeFolder.createdByName}
                  </p>
                </div>
                <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                  <ClipboardList size={14} /> {todos.length} {todos.length === 1 ? 'Task' : 'Tasks'}
                </span>
              </div>

              {/* Add Task Form */}
              <form onSubmit={handleCreateTask} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a task description..."
                  className="flex-grow text-xs border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-indigo-500 bg-slate-50/50"
                  value={newTaskText}
                  onChange={e => setNewTaskText(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl px-5 py-3 text-xs font-bold transition-colors shadow flex items-center gap-1.5 shrink-0"
                >
                  <Plus size={16} /> Add Task
                </button>
              </form>

              {/* Tasks List */}
              <div className="space-y-3">
                {todos.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-slate-100 rounded-xl">
                    <ClipboardList size={32} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 font-bold">This folder is empty.</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Add tasks above to get started!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {todos.map(todo => {
                      const isEditing = editingTaskId === todo.id;
                      const isCreator = todo.createdBy === auth.currentUser?.uid;
                      const canModify = isAdmin || isCreator;
                      return (
                        <div key={todo.id} className="flex items-center justify-between py-3.5 gap-4 group">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Toggle Completion */}
                            <button
                              onClick={() => handleToggleTask(todo.id, todo.completed)}
                              disabled={!canModify}
                              className={`text-slate-400 transition-colors shrink-0 ${
                                canModify ? 'hover:text-indigo-600' : 'cursor-not-allowed opacity-80'
                              }`}
                            >
                              {todo.completed ? (
                                <CheckCircle size={20} className="text-emerald-500 fill-emerald-50" />
                              ) : (
                                <Circle size={20} />
                              )}
                            </button>

                            {/* Task text or edit input */}
                            {isEditing ? (
                              <div className="flex gap-2 flex-1">
                                <input
                                  type="text"
                                  className="flex-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-indigo-500"
                                  value={editingTaskText}
                                  onChange={e => setEditingTaskText(e.target.value)}
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleSaveTaskEdit(todo.id)}
                                  className="p-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg border border-indigo-100"
                                  title="Save Changes"
                                >
                                  <Save size={14} />
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingTaskId(null);
                                    setEditingTaskText('');
                                  }}
                                  className="p-1.5 bg-slate-50 text-slate-500 hover:bg-slate-100 rounded-lg border border-slate-200"
                                  title="Cancel"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <div className="min-w-0">
                                <span
                                  className={`text-xs font-semibold break-all ${
                                    todo.completed ? 'text-slate-400 line-through font-normal' : 'text-slate-700'
                                  }`}
                                >
                                  {todo.task}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5 text-[9px] text-slate-400 font-bold uppercase">
                                  <span>Added by: {todo.createdByName}</span>
                                  <span>•</span>
                                  <span>{new Date(todo.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Action controls */}
                          {!isEditing && canModify && (
                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  setEditingTaskId(todo.id);
                                  setEditingTaskText(todo.task);
                                }}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                                title="Edit Task"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setTaskToDelete(todo.id)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete Task"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200/75 rounded-2xl p-16 text-center shadow-sm">
              <FolderIcon size={48} className="text-slate-300 mx-auto mb-4 animate-bounce" />
              <h3 className="text-lg font-bold text-slate-800">Select or Create a Folder</h3>
              <p className="text-sm text-slate-500 mt-1">Please select a folder on the left sidebar to access its to-do checklist items.</p>
            </div>
          )}
        </div>
      </div>

      {/* Custom Confirmation Modal for Deleting Folder */}
      <AnimatePresence>
        {folderToDelete && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 text-red-600">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <ShieldAlert size={24} />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">Delete Folder Permanently?</h3>
                </div>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                  Are you sure you want to delete folder <span className="text-slate-800 font-bold">"{folderToDelete.name}"</span> and all of its associated tasks? This action is irreversible.
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setFolderToDelete(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteFolder(folderToDelete.id, folderToDelete.name)}
                    disabled={saving}
                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                  >
                    {saving ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Modal for Deleting Task */}
      <AnimatePresence>
        {taskToDelete && (
          <div className="fixed inset-0 bg-slate-950/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl max-w-sm w-full border border-slate-200 overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 text-red-600">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <ShieldAlert size={24} />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">Delete Task?</h3>
                </div>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                  Are you sure you want to permanently delete this task item?
                </p>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setTaskToDelete(null)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl border border-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(taskToDelete)}
                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
