import { useEffect, useState } from 'react';
import { supabase, type User } from '@/lib/supabase';
import { IconView, IconEdit, IconTrash, IconKey, IconPlus, IconDownload, IconSearch } from '@/components/Icons';

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('users').select('*').order('created_at', { ascending: false }).then(({ data }) => setUsers(data || []));
  }, []);

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const deleteUser = async (id: string) => {
    await supabase.from('users').delete().eq('id', id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <div className="users-page">
      <div className="page-toolbar">
        <div className="search-wrapper">
          <IconSearch size={16} className="search-prefix" />
          <input className="search-input" placeholder="Search by name, username, or email..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="toolbar-actions">
          <button className="btn-primary"><IconPlus size={15} /> Add User</button>
          <button className="btn-secondary"><IconDownload size={15} /> Export</button>
        </div>
      </div>

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
              <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
              <td><span className={`status-badge ${u.status}`}>{u.status}</span></td>
              <td>{u.email}</td>
              <td>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
              <td>
                <div className="row-actions">
                  <button className="action-btn" title="View"><IconView size={15} /></button>
                  <button className="action-btn" title="Edit"><IconEdit size={15} /></button>
                  <button className="action-btn" title="Delete" onClick={() => deleteUser(u.id)}><IconTrash size={15} /></button>
                  <button className="action-btn" title="Reset Password"><IconKey size={15} /></button>
                </div>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={7} className="empty-state">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
