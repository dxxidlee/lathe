import { createElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { findTool } from '../tools/registry';
import { Mark } from '../brand/Wordmark';
import { toolIcon } from './icons';
import { useShell } from './state';
import type { Tab } from './state';

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}

export function TabBar({ tabs, activeTabId, onActivate, onClose, onReorder }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const navigate = useNavigate();
  const { tabLabels } = useShell();

  const activate = (id: string) => {
    onActivate(id);
    navigate(`/t/${id}`);
  };

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab, i) => {
        const tool = findTool(tab.id);
        const label = tab.id === 'make' ? 'Make a tool'
          : tab.id === 'library' ? 'Library'
          : tab.id.startsWith('board-') ? (tabLabels[tab.id] ? `Board \u00b7 ${tabLabels[tab.id]}` : 'Board')
          : tool?.name ?? tab.id;
        const active = tab.id === activeTabId;
        const Icon = tab.id.startsWith('board-') ? toolIcon('board') : toolIcon(tab.id);
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`tab${active ? ' is-active' : ''}${dragIdx === i ? ' is-dragging' : ''}`}
            onClick={() => activate(tab.id)}
            draggable={!tab.pinned}
            onDragStart={e => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
            onDragEnd={() => setDragIdx(null)}
            onDragOver={e => { if (!tab.pinned) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); if (!isNaN(from)) onReorder(from, i); setDragIdx(null); }}
          >
            {tab.id === 'make' ? <Mark className="tab__mark" /> : Icon ? createElement(Icon, { className: 'tab__icon', size: 16, strokeWidth: 1.5 }) : null}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }} title={label}>{label}</span>
            {!tab.pinned && (
              <span className="tab__close" role="button" aria-label={`Close ${label}`}
                onClick={e => { e.stopPropagation(); onClose(tab.id); }}>
                <X size={12} strokeWidth={2} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
