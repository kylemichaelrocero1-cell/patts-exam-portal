/*
  PATTS Exam — Icon component (ES module)
  Drop into src/components/Icon.jsx
  Usage: <Icon name="clipboard" size={18} />
*/
import React from 'react';

const PATHS = {
  // Navigation
  'home':         <><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></>,
  'grid':         <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  'layers':       <><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
  'menu':         <><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></>,
  'arrow-right':  <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  'arrow-left':   <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>,
  'chevron-right':<path d="m9 6 6 6-6 6"/>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'chevron-up':   <path d="m6 15 6-6 6 6"/>,
  'arrow-up-right':<><path d="M7 17 17 7"/><path d="M8 7h9v9"/></>,
  'external':     <><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></>,

  // Actions
  'plus':         <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  'minus':        <path d="M5 12h14"/>,
  'check':        <path d="m5 12 5 5 9-11"/>,
  'check-circle':<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  'x':            <><path d="M6 6l12 12"/><path d="M18 6l-12 12"/></>,
  'x-circle':     <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></>,
  'search':       <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  'filter':       <path d="M3 5h18l-7 9v5l-4 2v-7L3 5z"/>,
  'sort':         <><path d="M7 3v18"/><path d="m3 7 4-4 4 4"/><path d="M17 21V3"/><path d="m13 17 4 4 4-4"/></>,
  'refresh':      <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,
  'download':     <><path d="M12 4v12"/><path d="m6 12 6 6 6-6"/><path d="M4 20h16"/></>,
  'upload':       <><path d="M12 20V8"/><path d="m6 12 6-6 6 6"/><path d="M4 4h16"/></>,
  'send':         <path d="m22 2-7 20-4-9-9-4 20-7z"/>,
  'more':         <><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></>,
  'more-v':       <><circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/></>,

  // Status
  'clock':        <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  'timer':        <><circle cx="12" cy="13" r="8"/><path d="M9 2h6"/><path d="M12 8v5l3 2"/></>,
  'calendar':     <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></>,
  'alert':        <><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/></>,
  'alert-circle':<><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17v.5"/></>,
  'info':         <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></>,
  'help':         <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2.5 3v1M12 17v.5"/></>,
  'eye':          <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  'eye-off':      <><path d="M3 3l18 18"/><path d="M10.5 6.5A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a14 14 0 0 1-3.5 4M6.7 6.7A14 14 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"/></>,
  'flag':         <><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></>,
  'dot':          <circle cx="12" cy="12" r="3"/>,
  'circle':       <circle cx="12" cy="12" r="9"/>,
  'activity':     <path d="M3 12h4l3-8 4 16 3-8h4"/>,
  'trend-up':     <><path d="m3 17 7-7 4 4 7-7"/><path d="M14 7h7v7"/></>,
  'bar-chart':    <><path d="M3 21h18"/><rect x="6" y="11" width="3" height="9"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="14" width="3" height="6"/></>,

  // People
  'user':         <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>,
  'users':        <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5"/><path d="M16 4.5a3.5 3.5 0 1 1 0 7"/><path d="M21 20c0-2.6-1.9-4.8-4.5-5.3"/></>,
  'user-plus':    <><circle cx="9" cy="8" r="4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M19 8v6"/><path d="M22 11h-6"/></>,
  'graduation':   <><path d="M2 9 12 4l10 5-10 5-10-5z"/><path d="M6 11v6c0 1 3 3 6 3s6-2 6-3v-6"/><path d="M22 9v6"/></>,
  'shield':       <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/></>,
  'shield-check': <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2.5 2.5L16 10"/></>,

  // Content
  'file-text':    <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></>,
  'file-plus':    <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/></>,
  'bookmark':     <path d="M5 3h14a2 2 0 0 1 2 2v16l-9-4-9 4V5a2 2 0 0 1 2-2z"/>,
  'clipboard':    <><rect x="6" y="4" width="12" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></>,
  'clipboard-check':<><rect x="6" y="4" width="12" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></>,
  'edit':         <><path d="M14 4h-9a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-9"/><path d="M18.5 2.5a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
  'pencil':       <><path d="m12 20 9-9-3-3-9 9-1 4 4-1z"/><path d="m14 7 3 3"/></>,
  'trash':        <><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></>,
  'copy':         <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
  'archive':      <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/></>,
  'book':         <><path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z"/><path d="M19 16H7a3 3 0 0 0-3 3"/></>,

  // Security
  'lock':         <><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  'unlock':       <><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7-3"/></>,
  'key':          <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3M14 9l3 3"/></>,

  // System
  'logout':       <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h11"/></>,
  'login':        <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M14 8l4 4-4 4"/><path d="M7 12h11"/></>,
  'settings':     <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  'bell':         <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 0 0 4 0"/></>,
  'message':      <><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-5 4v-4H5a2 2 0 0 1-2-2V6z"/></>,

  // Media
  'image':        <><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 19"/></>,

  // Aviation
  'plane':        <path d="M3 12 21 5l-3 8 3 6-6-3-8 3 3-7L3 12z"/>,
  'plane-takeoff':<><path d="M2 22h20"/><path d="m21 8-7 7-9-3 3-2 4 1L8 7l2-1 6 3 5-1z"/></>,
  'compass':      <><circle cx="12" cy="12" r="9"/><path d="m9 15 2-6 6-2-2 6-6 2z"/></>,
  'navigation':   <path d="m3 11 19-8-8 19-2-9-9-2z"/>,
};

export default function Icon({ name, size = 18, color = 'currentColor', strokeWidth = 1.75, style, ...rest }) {
  const path = PATHS[name];
  if (!path) {
    if (typeof console !== 'undefined') console.warn(`<Icon> unknown name: "${name}"`);
    return null;
  }
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      {path}
    </svg>
  );
}
