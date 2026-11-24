import type { PageInfo } from './api'

export type MemberStatus = 'ACTIVE' | 'INACTIVE'
export type Gender = 'MALE' | 'FEMALE' | 'OTHER'

/** A gym member as returned by the backend (toPublicMember_). */
export interface Member {
  memberId: string
  fullName: string
  phone: string
  email: string | null
  gender: Gender | null
  dateOfBirth: string | null
  address: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  /** YYYY-MM-DD */
  joinDate: string
  status: MemberStatus
  notes: string | null
  createdAt: string
  updatedAt: string
  /** Phase 9: assigned trainer (User_ID) and their name. */
  trainerId: string | null
  trainerName: string | null
}

export interface MemberListQuery {
  trainerId?: string
  search?: string
  status?: MemberStatus
  page?: number
  pageSize?: number
}

export interface MemberListResponse extends PageInfo {
  members: Member[]
  counts: { all: number; active: number; inactive: number }
}

/** Editable fields, as strings for form inputs ('' = empty). */
export interface MemberFormValues {
  fullName: string
  phone: string
  email: string
  gender: '' | Gender
  dateOfBirth: string
  address: string
  emergencyContactName: string
  emergencyContactPhone: string
  joinDate: string
  notes: string
  trainerId: string
}

export type MemberFormField = keyof MemberFormValues
export type MemberFormErrors = Partial<Record<MemberFormField, string>>
