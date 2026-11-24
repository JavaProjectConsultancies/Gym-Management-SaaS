export type StaffRole = 'GYM_ADMIN' | 'TRAINER' | 'STAFF'
export type UserRole = StaffRole | 'GYM_OWNER' | 'MEMBER' | 'PLATFORM_ADMIN'

/** A person on the gym's team (central Users row). */
export interface StaffMember {
  userId: string
  fullName: string
  email: string
  role: UserRole
  status: 'ACTIVE' | 'INACTIVE'
  createdAt: string
  updatedAt: string
}

export interface TrainerOption {
  userId: string
  fullName: string
}
