/**
 * LINE Flex Card Templates for Local Service Booking SaaS
 * Renders high-quality, professional Flex Cards for LINE OA messages
 */

export interface FlexBookingDetails {
  bookingCode: string;
  shopName: string;
  serviceName: string;
  staffName: string;
  bookingDate: string;
  startTime: string;
  statusText: string;
  depositAmount: number;
  totalPrice: number;
}

export function createBookingBoundFlexCard(details: FlexBookingDetails) {
  return {
    type: 'flex',
    altText: `ผูกคิวสำเร็จ! รหัสการจอง ${details.bookingCode} - ${details.shopName}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F172A',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'คิวการจองของคุณ',
            weight: 'bold',
            color: '#38BDF8',
            size: 'xs'
          },
          {
            type: 'text',
            text: details.shopName,
            weight: 'bold',
            color: '#FFFFFF',
            size: 'xl',
            margin: 'xs'
          },
          {
            type: 'text',
            text: `รหัสจอง: ${details.bookingCode}`,
            color: '#94A3B8',
            size: 'xs',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E293B',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'สถานะคิว',
                color: '#94A3B8',
                size: 'xs',
                flex: 2
              },
              {
                type: 'text',
                text: details.statusText,
                weight: 'bold',
                color: '#F59E0B',
                size: 'xs',
                align: 'end',
                flex: 3
              }
            ]
          },
          {
            type: 'separator',
            color: '#334155'
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: 'บริการ',
                    color: '#94A3B8',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: details.serviceName,
                    color: '#F8FAFC',
                    size: 'xs',
                    weight: 'bold',
                    align: 'end',
                    flex: 3,
                    wrap: true
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: 'พนักงาน',
                    color: '#94A3B8',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: details.staffName,
                    color: '#F8FAFC',
                    size: 'xs',
                    align: 'end',
                    flex: 3
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: 'เวลานัดหมาย',
                    color: '#94A3B8',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: `${details.bookingDate} @ ${details.startTime} น.`,
                    color: '#38BDF8',
                    size: 'xs',
                    weight: 'bold',
                    align: 'end',
                    flex: 3
                  }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: 'ยอดมัดจำ',
                    color: '#94A3B8',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: `฿${details.depositAmount}.00`,
                    color: '#10B981',
                    size: 'xs',
                    weight: 'bold',
                    align: 'end',
                    flex: 3
                  }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F172A',
        paddingAll: '12px',
        contents: [
          {
            type: 'text',
            text: '✅ ผูกบัญชีรับแจ้งเตือนเรียบร้อยแล้ว ระบบจะส่งข้อความเตือนก่อนเวลานัดหมาย',
            color: '#10B981',
            size: 'xxs',
            align: 'center',
            wrap: true
          }
        ]
      }
    }
  };
}

export function createBookingLinkBoundFlexCard(details: Pick<FlexBookingDetails, 'bookingCode' | 'shopName' | 'bookingDate' | 'startTime'>) {
  return {
    type: 'flex',
    altText: `ผูกคิวสำเร็จ! รหัสการจอง ${details.bookingCode} - ${details.shopName}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0F172A',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'ผูกบัญชีรับแจ้งเตือนแล้ว', weight: 'bold', color: '#38BDF8', size: 'sm' },
          { type: 'text', text: details.shopName, weight: 'bold', color: '#FFFFFF', size: 'lg', margin: 'sm' },
          { type: 'text', text: `รหัสจอง: ${details.bookingCode}`, color: '#94A3B8', size: 'xs', margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E293B',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          { type: 'text', text: `วันนัดหมาย ${details.bookingDate} เวลา ${details.startTime}`, color: '#F8FAFC', size: 'sm', wrap: true },
          { type: 'text', text: `รหัสคิว: ${details.bookingCode}`, color: '#38BDF8', size: 'sm', weight: 'bold', wrap: true },
          { type: 'text', text: 'ระบบจะส่งข้อความแจ้งเตือนก่อนเวลานัดหมาย 3 ชั่วโมง', color: '#10B981', size: 'xs', wrap: true },
          { type: 'text', text: 'We will remind you 3 hours before your appointment.', color: '#94A3B8', size: 'xxs', wrap: true },
        ],
      },
    },
  };
}
