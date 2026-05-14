import { useState } from 'react';
import { DirectMessagePanel } from '@/components/DirectMessagePanel';
import type { DirectMessageSelectedUser } from '@/components/DirectMessagePanel';

const LIGHT_TEXT = '#0f172a';
const LIGHT_TEXT_MUTED = '#334155';
const LIGHT_BG = '#ffffff';

export default function DirectMessagesPage() {
  const [selectedUser, setSelectedUser] = useState<DirectMessageSelectedUser>(null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: LIGHT_BG,
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div style={{ paddingTop: 4, paddingBottom: 8 }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: LIGHT_TEXT,
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          Chats
        </h1>
        <div
          style={{
            fontSize: 11,
            color: LIGHT_TEXT_MUTED,
            marginTop: 2,
            fontWeight: 700,
          }}
        >
          {selectedUser ? `Chat with ${selectedUser.name}` : 'Direct messages'}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <DirectMessagePanel onSelectedUserChange={setSelectedUser} />
      </div>
    </div>
  );
}
