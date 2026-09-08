'use client';

import { useParams } from 'next/navigation';
import { AlertTriangle, PackageOpen } from 'lucide-react';

export default function OrderScaffoldPage() {
  const params = useParams();
  const slug = typeof params?.slug === 'string' ? params.slug : 'shop';
  return <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100"><section className="mx-auto max-w-lg rounded-2xl border border-amber-500/30 bg-slate-900 p-6 text-center shadow-xl"><PackageOpen className="mx-auto h-10 w-10 text-emerald-400" /><h1 className="mt-4 text-xl font-bold">สั่งสินค้ากับ {slug}</h1><p className="mt-2 text-sm text-slate-300">หน้าร้านสินค้า, เลือกจำนวน, วันที่พร้อมรับ, ข้อมูลลูกค้า, การรับสินค้า และติดตามคำสั่งซื้อ จะเปิดใช้หลัง Order runtime ผ่านการตรวจสอบ</p><div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"><AlertTriangle className="h-4 w-4" />ยังไม่เปิดรับคำสั่งซื้อ — ไม่มีการสร้างรายการหรือจองกำลังผลิต</div></section></main>;
}
