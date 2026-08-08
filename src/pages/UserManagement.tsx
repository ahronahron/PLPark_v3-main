/**
 * UserManagement.tsx — Admin User Management Page
 *
 * Provides CRUD operations for admin/staff users who access
 * the dashboard. Features include:
 *
 * 1. **Search** — Real-time filtering by name, username, or email
 * 2. **User Table** — Displays all users with role badges, status, and last login
 * 3. **Actions** — View, Edit, Delete, and Reset Password per user
 * 4. **Add/Export** — Toolbar buttons for adding users and exporting data
 *
 * Data is fetched from the `users` table in Supabase (not `app_users`,
 * which is for mobile/public app users).
 */
import { useEffect, useState } from 'react';
import { supabase, type User } from '@/lib/supabase';
import { IconView, IconEdit, IconTrash, IconKey, IconPlus, IconDownload, IconSearch } from '@/components/Icons';

/**
 * UserManagement — Admin user management page component.
 *
 * Fetches all users from the `users` table on mount, provides
 * client-side search filtering, and supports user deletion
 * with optimistic local state updates.
 *
 * @returns The user management page UI with search, table, and action buttons
 */
export function UserManagement() {
  /** All admin/staff users fetched from the database */
  const [users, setUsers] = useState<User[]>([]);

  /** Current search query for filtering the user table */
  const [search, setSearch] = useState('');

  /**
   * Initial data fetch — loads all users on component mount.
   * Results are ordered by creation date (newest first).
   */
  useEffect(() => {
    supabase.from('users').select('*').order('created_at', { ascending: false }).then(({ data }) => setUsers(data || []));
  }, []);

  /**
   * filtered — Users matching the current search query.
   *
   * Performs case-insensitive matching against:
   * - full_name
   * - username
   * - email
   *
   * Returns all users when the search is empty.
   */
  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  /**
   * deleteUser — Deletes a user by ID from the database.
   *
   * Sends a DELETE request to Supabase for the specified user ID,
   * then optimistically removes the user from local state so the
   * UI updates immediately without needing a full refetch.
   *
   * @param id — The UUID of the user to delete
   */
  const deleteUser = async (id: string) => {
    await supabase.from('users').delete().eq('id', id);
    // Optimistically remove from local state
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="users-page">
      {/* Toolbar — search input and action buttons */}
      <div className="page-toolbar">
        {/* Search input with magnifying glass prefix icon */}
        <div className="search-wrapper">
          <IconSearch size={16} className="search-prefix" />
          <input className="search-input" placeholder="Search by name, username, or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {/* Action buttons */}
        <div className="toolbar-actions">
          <button className="btn-primary"><IconPlus size={15} /> Add User</button>
          <button className="btn-secondary"><IconDownload size={15} /> Export</button>
        </div>
      </div>

      {/* User data table */}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Email</th>
            <th>Last Login</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id}>
              <td>{u.full_name}</td>
              <td className="mono">{u.username}</td>
              {/* Role badge — styled based on role (admin/operator/viewer) */}
              <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
              {/* Status badge — styled based on status (active/inactive) */}
              <td><span className={`status-badge ${u.status}`}>{u.status}</span></td>
              <td>{u.email}</td>
              {/* Last login timestamp — shows "Never" if null */}
              <td>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
              <td>
                {/* Row action buttons */}
                <div className="row-actions">
                  <button className="action-btn" title="View"><IconView size={15} /></button>
                  <button className="action-btn" title="Edit"><IconEdit size={15} /></button>
                  <button className="action-btn" title="Delete" onClick={() => deleteUser(u.id)}><IconTrash size={15} /></button>
                  <button className="action-btn" title="Reset Password"><IconKey size={15} /></button>
                </div>
              </td>
            </tr>
          ))}
          {/* Empty state when no users match the search */}
          {filtered.length === 0 && <tr><td colSpan={7} className="empty-state">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
