/*
  PATTS Exam — Icon component.
  Drawn on one grid: 24x24, 1.6 stroke, round caps and joins, currentColor.
  The everyday glyphs come from the AeroHub icon set, so new ones should match.
  Usage: <Icon name="clipboard" size={18} />
*/
import React from 'react';

const PATHS = {
  // Navigation
  'home': <><path d="M3.5 11.3 12 4.2l8.5 7.1"/><path d="M5.6 9.7V19a1 1 0 0 0 1 1h10.8a1 1 0 0 0 1-1V9.7"/><path d="M9.6 20v-5.3a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1V20"/></>,
  'grid':         <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  'layers':       <><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></>,
  'menu': <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  'arrow-right':  <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  'arrow-left':   <><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>,
  'chevron-right': <><path d="m9.5 6 6 6-6 6"/></>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'chevron-up':   <path d="m6 15 6-6 6 6"/>,
  'arrow-up-right':<><path d="M7 17 17 7"/><path d="M8 7h9v9"/></>,
  'external':     <><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></>,

  // Actions
  'plus': <><path d="M12 5v14M5 12h14"/></>,
  'minus':        <path d="M5 12h14"/>,
  'check': <><path d="m5 12.5 4.8 4.8L19 7.5"/></>,
  'check-circle':<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  'x': <><path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/></>,
  'x-circle':     <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></>,
  'search': <><circle cx="11" cy="11" r="6.6"/><path d="m20 20-3.9-3.9"/></>,
  'filter': <><path d="M4.2 5.6h15.6l-6 7.1v5.7l-3.6-1.8v-3.9Z"/></>,
  'sort':         <><path d="M7 3v18"/><path d="m3 7 4-4 4 4"/><path d="M17 21V3"/><path d="m13 17 4 4 4-4"/></>,
  'refresh':      <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,
  'download': <><path d="M12 4v11M12 15l3.8-3.8M12 15l-3.8-3.8M5 19.4h14"/></>,
  'upload': <><path d="M12 15.4V4.4M12 4.4 15.8 8.2M12 4.4 8.2 8.2M5 19.4h14"/></>,
  'send':         <path d="m22 2-7 20-4-9-9-4 20-7z"/>,
  'sliders':      <><path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/></>,
  'more':         <><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></>,
  'more-v':       <><circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/></>,

  // Status
  'clock': <><circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 1.9"/></>,
  'timer': <><circle cx="12" cy="13.2" r="7.4"/><path d="M12 13.2V8.9"/><path d="M9.5 3.6h5M12 3.6v2.3"/><path d="m18.4 7.1 1.5-1.5"/></>,
  'calendar': <><rect x="4" y="5.6" width="16" height="14.8" rx="2"/><path d="M4 10h16M8.6 3.6v4M15.4 3.6v4"/></>,
  'alert':        <><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/></>,
  'alert-circle':<><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17v.5"/></>,
  'info':         <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></>,
  'help': <><circle cx="12" cy="12" r="8.4"/><path d="M9.6 9.7a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5"/><circle cx="12" cy="16.8" r=".7" fill="currentColor" stroke="none"/></>,
  'eye':          <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  'eye-off':      <><path d="M3 3l18 18"/><path d="M10.5 6.5A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a14 14 0 0 1-3.5 4M6.7 6.7A14 14 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"/></>,
  'flag': <><path d="M6 21V3.8"/><path d="M6 5.2h9.6l-1.9 2.9 1.9 2.9H6"/></>,
  'dot':          <circle cx="12" cy="12" r="3"/>,
  'circle':       <circle cx="12" cy="12" r="9"/>,
  'activity':     <path d="M3 12h4l3-8 4 16 3-8h4"/>,
  'trend-up':     <><path d="m3 17 7-7 4 4 7-7"/><path d="M14 7h7v7"/></>,
  'bar-chart': <><path d="M4 20.2h16"/><rect x="5.2" y="11.6" width="3.8" height="6.6" rx="1"/><rect x="10.1" y="6.6" width="3.8" height="11.6" rx="1"/><rect x="15" y="13.8" width="3.8" height="4.4" rx="1"/></>,

  // People
  'user': <><circle cx="12" cy="8.4" r="3.6"/><path d="M5.4 19.4a6.7 6.7 0 0 1 13.2 0"/></>,
  'users':        <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5"/><path d="M16 4.5a3.5 3.5 0 1 1 0 7"/><path d="M21 20c0-2.6-1.9-4.8-4.5-5.3"/></>,
  'user-plus':    <><circle cx="9" cy="8" r="4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M19 8v6"/><path d="M22 11h-6"/></>,
  'graduation':   <><path d="M2 9 12 4l10 5-10 5-10-5z"/><path d="M6 11v6c0 1 3 3 6 3s6-2 6-3v-6"/><path d="M22 9v6"/></>,
  'shield':       <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/></>,
  'shield-check': <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2.5 2.5L16 10"/></>,

  // Content
  'file-text': <><path d="M6.4 3.6h7.2l4 4V19.6a.8.8 0 0 1-.8.8H6.4a.8.8 0 0 1-.8-.8V4.4a.8.8 0 0 1 .8-.8Z"/><path d="M13.4 3.6V7a.8.8 0 0 0 .8.8h3.4"/><path d="M8.6 12h6.8M8.6 15.2h6.8M8.6 8.9h2.4"/></>,
  'file-plus':    <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/></>,
  'bookmark': <><path d="M6.4 4.6a1 1 0 0 1 1-1h9.2a1 1 0 0 1 1 1V20l-5.6-3.4L6.4 20Z"/></>,
  'clipboard':    <><rect x="6" y="4" width="12" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></>,
  'clipboard-check': <><rect x="5.2" y="5" width="13.6" height="15.4" rx="2"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="m9.2 13 1.9 1.9 3.7-3.8"/></>,
  'edit': <><path d="m5 19 .9-3.8L16.4 4.7a1.2 1.2 0 0 1 1.7 0l1.2 1.2a1.2 1.2 0 0 1 0 1.7L8.8 18.1 5 19Z"/><path d="M14.4 6.7 17.3 9.6"/></>,
  'pencil': <><path d="m5 19 .9-3.8L16.4 4.7a1.2 1.2 0 0 1 1.7 0l1.2 1.2a1.2 1.2 0 0 1 0 1.7L8.8 18.1 5 19Z"/><path d="M14.4 6.7 17.3 9.6"/></>,
  'trash': <><path d="M4.5 6.8h15M9 6.8V5.2a1.2 1.2 0 0 1 1.2-1.2h3.6A1.2 1.2 0 0 1 15 5.2v1.6"/><path d="M6.4 6.8V19a1.2 1.2 0 0 0 1.2 1.2h8.8A1.2 1.2 0 0 0 17.6 19V6.8M10 10.5v6M14 10.5v6"/></>,
  'copy':         <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
  'archive':      <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/></>,
  'book': <><path d="M12 6.6C10.4 5.1 7.9 4.6 4.4 5.2A.8.8 0 0 0 3.8 6v11.3a.8.8 0 0 0 .9.8c3.2-.5 5.6 0 7.3 1.4 1.7-1.4 4.1-1.9 7.3-1.4a.8.8 0 0 0 .9-.8V6a.8.8 0 0 0-.6-.8C16.1 4.6 13.6 5.1 12 6.6Z"/><path d="M12 6.6v12.9"/></>,

  // Security
  'lock': <><rect x="5.2" y="10.6" width="13.6" height="9.4" rx="2"/><path d="M8 10.6V8a4 4 0 0 1 8 0v2.6"/></>,
  'unlock':       <><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7-3"/></>,
  'key':          <><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3M14 9l3 3"/></>,

  // System
  'logout': <><path d="M14 5.4H6.2a1 1 0 0 0-1 1v11.2a1 1 0 0 0 1 1H14"/><path d="M16.8 8.6 20.4 12 16.8 15.4M10 12h10.2"/></>,
  'login':        <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M14 8l4 4-4 4"/><path d="M7 12h11"/></>,
  'settings': <><circle cx="12" cy="12" r="2.9"/><path d="M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V20.5a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.2 16.5l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.5a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7.5 4.1l.1.1a1.6 1.6 0 0 0 1.8.3H9.4a1.6 1.6 0 0 0 1-1.5V2.9a2 2 0 0 1 4 0V3a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9.4a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></>,
  'bell': <><path d="M6.2 16.4V11a5.8 5.8 0 0 1 11.6 0v5.4l1.6 2.4H4.6Z"/><path d="M10 19.2a2 2 0 0 0 4 0"/></>,
  'message':      <><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9l-5 4v-4H5a2 2 0 0 1-2-2V6z"/></>,

  // Media
  'image': <><rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="8.7" cy="10" r="1.9"/><path d="m4 16.5 5.2-4.7 3.8 3.4 2.8-2.4 4.2 3.7"/></>,

  // Aviation and assessment, from the AeroHub icon set
  'mathematics': <><path d="M6.4 5h9.2l-5.6 7 5.6 7H6.4"/></>,
  'structures': <><path d="M7 5h10M7 19h10M12 5v14"/></>,
  'trophy': <><path d="M7.6 4.2h8.8v3.9a4.4 4.4 0 0 1-8.8 0Z"/><path d="M7.6 5.7H5.2v1.4a2.5 2.5 0 0 0 2.5 2.5M16.4 5.7h2.4v1.4a2.5 2.5 0 0 1-2.5 2.5"/><path d="M12 12.5v3M9 20h6M9.5 20l.6-4.5h3.8l.6 4.5"/></>,
  'airfoil': <><path d="M3 13.2c4.2-5.8 11.8-6.8 18-3.1-5 3.9-12.6 4.9-18 3.1Z"/><path d="M5.4 12.6c3 .5 6.6.2 9.6-1.4"/></>,
  'exam': <><path d="M6.4 3.6h7.2l4 4V19.6a.8.8 0 0 1-.8.8H6.4a.8.8 0 0 1-.8-.8V4.4a.8.8 0 0 1 .8-.8Z"/><path d="M13.4 3.6V7a.8.8 0 0 0 .8.8h3.4"/><path d="m8.6 13 1.3 1.3 2.4-2.4M8.6 17l1.3 1.3 2.4-2.4"/></>,
  'practice': <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></>,
  'question-bank': <><path d="M8 6.6h9.4A1.6 1.6 0 0 1 19 8.2v9.4"/><rect x="4" y="7.6" width="12" height="11.8" rx="2"/><path d="M7.7 11.2a2.3 2.3 0 0 1 4.5.7c0 1.5-2.2 1.8-2.2 3.1"/><circle cx="10" cy="17" r=".75" fill="currentColor" stroke="none"/></>,
  'plane':        <path d="M3 12 21 5l-3 8 3 6-6-3-8 3 3-7L3 12z"/>,
  'plane-takeoff':<><path d="M2 22h20"/><path d="m21 8-7 7-9-3 3-2 4 1L8 7l2-1 6 3 5-1z"/></>,
  'compass':      <><circle cx="12" cy="12" r="9"/><path d="m9 15 2-6 6-2-2 6-6 2z"/></>,
  'navigation':   <path d="m3 11 19-8-8 19-2-9-9-2z"/>,
  'bell-off':     <><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18 13.2V10a6 6 0 0 0-9.2-5.1"/><path d="M6.3 6.3A6 6 0 0 0 6 8v5l-2 3h13"/><path d="m3 3 18 18"/></>,
  'moon':         <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>,
  'battery':      <><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 10.5v3M9.5 10.5v3"/></>,
  'wifi':         <><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.6a10 10 0 0 1 14 0"/><path d="M8.5 16.3a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r=".6"/></>,
  'smartphone':   <><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></>,
  'ban':          <><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></>,
  'undo':         <><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></>,
};

export default function Icon({ name, size = 18, color = 'currentColor', strokeWidth = 1.6, style, ...rest }) {
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
