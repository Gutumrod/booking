'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Store, Users, DollarSign, CheckCircle2, XCircle, Search,
  Clock, ExternalLink,
} from 'lucide-react';
import {
  fetchPlatformAdminShops,
  setShopActive,
  extendShopTrial,
  updateShopPlan,
  type PlatformAdminShop,
  type PlatformSubscriptionPlan,
} from '@/lib/platform-admin-service';

const BOOKING_SITE_URL = (process.env.NEXT_PUBLIC_BOOKING_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

function planLabel(plan: string | null) {
  switch (plan) {
    case 'pro_990': return '🚀 Pro (990/ด.)';
    case 'basic_490': return '⚡ Basic (490/ด.)';
    default: return '🎁 Free Trial';
  }
}

function subscriptionStatusLabel(status: string | null) {
  switch (status) {
    case 'active': return { text: 'Active', cls: 'text-emerald-400' };
    case 'trialing': return { text: 'Trialing', cls: 'text-amber-400' };
    case 'past_due': return { text: 'Past Due', cls: 'text-orange-400' };
    case 'canceled': return { text: 'Canceled', cls: 'text-rose-400' };
    case 'unpaid': return { text: 'Unpaid', cls: 'text-rose-400' };
    case 'incomplete':
    case 'incomplete_expired': return { text: 'Incomplete', cls: 'text-rose-400' };
    default: return { text: 'ไม่มีข้อมูล', cls: 'text-slate-500' };
  }
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' }).format(date);
}

export default function PlatformSuperAdminPage() {
  const [shops, setShops] = useState<PlatformAdminShop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState<'active' | 'suspended' | 'all'>('active');
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingShopId, setPendingShopId] = useState<string | null>(null);

  const loadShops = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetchPlatformAdminShops();
      setShops(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'โหลดรายชื่อร้านค้าไม่สำเร็จ');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial synchronization with the remote platform shop list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadShops();
  }, [loadShops]);

  const triggerNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const activeShopsCount = shops.filter((s) => s.isActive).length;
  const suspendedShopsCount = shops.filter((s) => !s.isActive).length;
  const trialingCount = shops.filter((s) => s.subscriptionStatus === 'trialing').length;
  const mrr = shops
    .filter((s) => s.subscriptionStatus === 'active' || s.subscriptionStatus === 'past_due')
    .reduce((sum, s) => sum + (s.subscriptionPlan === 'pro_990' ? 990 : s.subscriptionPlan === 'basic_490' ? 490 : 0), 0);

  const filteredShops = shops.filter((s) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      (s.ownerName ?? '').toLowerCase().includes(q);
    if (!matchesSearch) return false;

    if (statusTab === 'active') return s.isActive;
    if (statusTab === 'suspended') return !s.isActive;
    return true;
  });

  const runAction = async (shopId: string, action: () => Promise<void>, successMsg: string) => {
    setPendingShopId(shopId);
    try {
      await action();
      await loadShops();
      triggerNotice(successMsg);
    } catch (error) {
      triggerNotice(`❌ ${error instanceof Error ? error.message : 'ทำรายการไม่สำเร็จ'}`);
    } finally {
      setPendingShopId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <header className="bg-slate-900 border-b border-purple-500/30 px-6 py-3.5 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 font-bold text-xl">
              👑
            </div>
            <div>
              <h1 className="font-bold text-base text-white">Platform Admin</h1>
              <p className="text-[11px] text-slate-400">บริหารร้านค้าทั้งหมดในระบบ • เปิด/ปิดบริการ • ปรับแพ็กเกจ/trial</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {notice && (
              <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-3 py-1 rounded-lg text-xs font-semibold animate-fade-in">
                {notice}
              </span>
            )}
            <Link
              href="/dashboard"
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-3 py-2 rounded-xl font-medium border border-slate-700 transition-all flex items-center gap-1.5"
            >
              <Store className="w-4 h-4 text-emerald-400" />
              สลับไปหน้า Dashboard ร้านค้า
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-6 py-8 flex-1 space-y-8">
        {loadError && (
          <div className="bg-rose-500/10 border border-rose-500/40 rounded-2xl p-4 text-sm text-rose-300">
            {loadError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl p-5 shadow-lg shadow-emerald-950/20">
            <div className="flex items-center justify-between text-emerald-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">รายได้ประจำเดือน (MRR)</span>
              <DollarSign className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-3xl font-extrabold text-white font-mono">฿{mrr.toLocaleString()}.00</p>
            <p className="text-[11px] text-emerald-400 mt-1">จากร้านที่ active/past_due เท่านั้น</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">ร้านค้าเปิดใช้งาน</span>
              <Store className="w-5 h-5 text-purple-400" />
            </div>
            <p className="text-3xl font-extrabold text-white font-mono">{activeShopsCount} <span className="text-xs font-normal text-slate-400">/ {shops.length} ร้าน</span></p>
          </div>

          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-amber-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">กำลังทดลองใช้ (Trial)</span>
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <p className="text-3xl font-extrabold text-white font-mono">{trialingCount} <span className="text-xs font-normal text-slate-400">ร้าน</span></p>
          </div>

          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center justify-between text-rose-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">ระงับบริการอยู่</span>
              <XCircle className="w-5 h-5 text-rose-400" />
            </div>
            <p className="text-3xl font-extrabold text-white font-mono">{suspendedShopsCount} <span className="text-xs font-normal text-slate-400">ร้าน</span></p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                รายชื่อร้านค้าในระบบทั้งหมด
              </h2>
              <p className="text-xs text-slate-400">เปิด/ปิดบริการ ขยายเวลา trial และปรับแพ็กเกจร้านค้า</p>
            </div>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setStatusTab('active')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${statusTab === 'active' ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                เปิดใช้งาน ({activeShopsCount})
              </button>
              <button
                onClick={() => setStatusTab('suspended')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${statusTab === 'suspended' ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40' : 'text-slate-400 hover:text-white'}`}
              >
                ระงับบริการ ({suspendedShopsCount})
              </button>
              <button
                onClick={() => setStatusTab('all')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all ${statusTab === 'all' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
              >
                ทั้งหมด ({shops.length})
              </button>
            </div>
          </div>

          <div className="relative w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="ค้นหานามร้าน / เจ้าของ / slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500 w-full"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-4 whitespace-nowrap">ร้านค้า / เจ้าของร้าน</th>
                  <th className="py-3 px-4 whitespace-nowrap">แพ็กเกจ</th>
                  <th className="py-3 px-4 whitespace-nowrap">สถานะ Subscription</th>
                  <th className="py-3 px-4 whitespace-nowrap">สิทธิ์สิ้นสุด/ตัดรอบ</th>
                  <th className="py-3 px-4 whitespace-nowrap">สถานะร้าน</th>
                  <th className="py-3 px-4 whitespace-nowrap text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {isLoading ? (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-500 text-xs">กำลังโหลด...</td></tr>
                ) : filteredShops.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-slate-500 text-xs">ไม่พบข้อมูลร้านค้าตามเงื่อนไขที่เลือก</td></tr>
                ) : (
                  filteredShops.map((shop) => {
                    const statusInfo = subscriptionStatusLabel(shop.subscriptionStatus);
                    const isBusy = pendingShopId === shop.shopId;
                    return (
                      <tr key={shop.shopId} className="hover:bg-slate-800/40 transition-all">
                        <td className="py-3.5 px-4">
                          <p className="font-bold text-white text-sm">{shop.name}</p>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-emerald-400">/book/{shop.slug}</span>
                            <a
                              href={`${BOOKING_SITE_URL}/book/${shop.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-purple-400 hover:underline flex items-center gap-0.5"
                              title="ดูหน้าจองที่ลูกค้าเห็นจริง"
                            >
                              <ExternalLink className="w-3 h-3" /> ดูหน้าจอง
                            </a>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            {shop.ownerName || 'ไม่ระบุชื่อเจ้าของ'}
                            {shop.phone && (
                              <> · <a href={`tel:${shop.phone}`} className="text-amber-300 underline">{shop.phone}</a></>
                            )}
                          </p>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <select
                            value={shop.subscriptionPlan ?? shop.requestedPlan}
                            disabled={isBusy}
                            onChange={(e) =>
                              runAction(
                                shop.shopId,
                                () => updateShopPlan(shop.shopId, e.target.value as PlatformSubscriptionPlan),
                                'ปรับแพ็กเกจร้านค้าเรียบร้อยแล้ว'
                              )
                            }
                            className="bg-slate-950 border border-purple-500/40 text-purple-300 px-2.5 py-1 rounded-lg text-[10px] font-bold focus:outline-none cursor-pointer disabled:opacity-50"
                          >
                            <option value="free_trial">🎁 Free Trial</option>
                            <option value="basic_490">⚡ Basic 490</option>
                            <option value="pro_990">🚀 Pro 990</option>
                          </select>
                        </td>

                        <td className={`py-3.5 px-4 whitespace-nowrap font-semibold ${statusInfo.cls}`}>
                          {statusInfo.text}
                          {shop.cancelAtPeriodEnd && <span className="ml-1 text-[10px] text-slate-400">(ยกเลิกปลายรอบ)</span>}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap font-mono text-slate-300">
                          {formatDate(shop.currentPeriodEnd)}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {shop.isActive ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> เปิดใช้งาน
                            </span>
                          ) : (
                            <span className="text-rose-400 font-semibold flex items-center gap-1 text-[11px]">
                              <XCircle className="w-3.5 h-3.5 text-rose-500" /> ระงับบริการ
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {shop.subscriptionStatus === 'trialing' && (
                              <button
                                disabled={isBusy}
                                onClick={() =>
                                  runAction(shop.shopId, () => extendShopTrial(shop.shopId, 14), 'ขยายเวลา trial +14 วัน เรียบร้อยแล้ว')
                                }
                                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2.5 py-1 rounded-lg text-[10px] font-bold shadow-sm disabled:opacity-50"
                              >
                                +14 วัน Trial
                              </button>
                            )}
                            <button
                              disabled={isBusy}
                              onClick={() =>
                                runAction(
                                  shop.shopId,
                                  () => setShopActive(shop.shopId, !shop.isActive),
                                  shop.isActive ? `ระงับบริการร้าน ${shop.name} เรียบร้อยแล้ว` : `เปิดคืนบริการร้าน ${shop.name} เรียบร้อยแล้ว`
                                )
                              }
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all shadow-sm disabled:opacity-50 ${
                                shop.isActive
                                  ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40'
                                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                              }`}
                            >
                              {shop.isActive ? 'ระงับบริการ' : 'เปิดคืนบริการ'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
