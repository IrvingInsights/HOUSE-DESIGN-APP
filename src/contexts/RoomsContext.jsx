import React, { createContext, useCallback, useMemo } from 'react';

/**
 * RoomsContext: Room/space definitions and operations.
 * Consumed by: Room list, plan view, room inspector, cost/carbon.
 * Triggers re-render: room added/removed/moved/resized/type-changed.
 */
export const RoomsContext = createContext();

export function RoomsProvider({ spec, onUpdate, children }) {
  const rooms = spec.rooms || [];

  const updateRooms = useCallback(
    (newRooms) => {
      onUpdate({ ...spec, rooms: newRooms });
    },
    [spec, onUpdate]
  );

  const addRoom = useCallback(
    (room) => {
      const id = room.id || `room-${Date.now()}`;
      updateRooms([...rooms, { ...room, id }]);
      return id;
    },
    [rooms, updateRooms]
  );

  const removeRoom = useCallback(
    (roomId) => {
      updateRooms(rooms.filter((r) => r.id !== roomId));
    },
    [rooms, updateRooms]
  );

  const updateRoom = useCallback(
    (roomId, updates) => {
      updateRooms(
        rooms.map((r) => (r.id === roomId ? { ...r, ...updates } : r))
      );
    },
    [rooms, updateRooms]
  );

  const moveRoom = useCallback(
    (roomId, x, y) => updateRoom(roomId, { x, y }),
    [updateRoom]
  );

  const resizeRoom = useCallback(
    (roomId, w, d) => updateRoom(roomId, { w, d }),
    [updateRoom]
  );

  const getRoomById = useCallback(
    (roomId) => rooms.find((r) => r.id === roomId),
    [rooms]
  );

  const getRoomsByLevel = useCallback(
    (level) => rooms.filter((r) => Number(r.level || 1) === level),
    [rooms]
  );

  const value = useMemo(
    () => ({
      rooms,
      addRoom,
      removeRoom,
      updateRoom,
      moveRoom,
      resizeRoom,
      getRoomById,
      getRoomsByLevel,
      totalArea: rooms.reduce((sum, r) => sum + (Number(r.w || 0) * Number(r.d || 0)), 0),
      roomCount: rooms.length,
    }),
    [rooms, addRoom, removeRoom, updateRoom, moveRoom, resizeRoom, getRoomById, getRoomsByLevel]
  );

  return <RoomsContext.Provider value={value}>{children}</RoomsContext.Provider>;
}
