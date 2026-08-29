"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildDroCalendarMonth, formatDroCalendarDate, isDroDateAvailable, monthKeyForDroDate, shiftDroCalendarMonth } from "./calendar";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type DroCalendarPickerProps = {
  availableDates: string[];
  selectedDate: string;
  loading: boolean;
  onSelect: (date: string) => void;
};

export function DroCalendarPicker({ availableDates, selectedDate, loading, onSelect }: DroCalendarPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [displayedMonth, setDisplayedMonth] = useState("");
  const sortedDates = useMemo(() => [...availableDates].sort(), [availableDates]);
  const firstMonth = monthKeyForDroDate(sortedDates[0] || "");
  const lastMonth = monthKeyForDroDate(sortedDates.at(-1) || "");
  const calendar = displayedMonth ? buildDroCalendarMonth(displayedMonth, sortedDates, selectedDate) : null;
  const disabled = loading || sortedDates.length === 0;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggleCalendar() {
    if (disabled) return;
    if (!open) setDisplayedMonth(monthKeyForDroDate(selectedDate || sortedDates.at(-1) || ""));
    setOpen(current => !current);
  }

  function selectDate(date: string) {
    if (!isDroDateAvailable(date, sortedDates)) return;
    setOpen(false);
    onSelect(date);
  }

  const triggerText = loading ? "Loading dates…" : selectedDate ? formatDroCalendarDate(selectedDate) : "No DRO dates";
  return <div className="dro-calendar-picker" ref={pickerRef}>
    <button type="button" className="dro-calendar-trigger" disabled={disabled} aria-expanded={open} aria-haspopup="dialog" aria-controls="dro-calendar-dialog" onClick={toggleCalendar}><span aria-hidden="true">▣</span>{triggerText}</button>
    {open && calendar && <div className="dro-calendar-popover" id="dro-calendar-dialog" role="dialog" aria-modal="false" aria-labelledby="dro-calendar-title">
      <div className="dro-calendar-header">
        <button type="button" disabled={displayedMonth <= firstMonth} aria-label="Show previous month" onClick={() => setDisplayedMonth(current => shiftDroCalendarMonth(current, -1))}>←</button>
        <strong id="dro-calendar-title">{calendar.label}</strong>
        <button type="button" disabled={displayedMonth >= lastMonth} aria-label="Show next month" onClick={() => setDisplayedMonth(current => shiftDroCalendarMonth(current, 1))}>→</button>
      </div>
      <div className="dro-calendar-weekdays" aria-hidden="true">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
      <div className="dro-calendar-grid" role="grid" aria-label={calendar.label}>
        {calendar.days.map((day, index) => day ? <button
          type="button"
          key={day.date}
          role="gridcell"
          className={day.selected ? "selected" : ""}
          disabled={!day.available}
          aria-disabled={!day.available}
          aria-current={day.selected ? "date" : undefined}
          aria-label={`${formatDroCalendarDate(day.date, true)} — ${day.available ? "DRO data available" : "No DRO data available"}`}
          onClick={() => selectDate(day.date)}
        >{day.day}</button> : <span className="dro-calendar-blank" aria-hidden="true" key={`blank-${index}`} />)}
      </div>
    </div>}
  </div>;
}
