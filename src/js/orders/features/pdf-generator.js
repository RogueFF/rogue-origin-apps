/**
 * PDF document generation feature
 * Generates invoices, packing slips, and document bundles
 * @module features/pdf-generator
 */

import { PDF_LIBS } from '../core/config.js';
import { isPdfLibrariesLoaded, setPdfLibrariesLoaded, getCachedShipments, getCurrentOrderID, findOrder } from '../core/state.js';
import { showToast } from '../ui/toast.js';
import { formatCurrency, formatDate, formatNumber } from '../utils/format.js';

/**
 * Ensure PDF libraries are loaded (lazy load)
 * @returns {Promise<boolean>}
 */
export async function ensurePDFLibrariesLoaded() {
  if (isPdfLibrariesLoaded()) return true;

  try {
    // Load jsPDF
    await loadScript(PDF_LIBS.jspdf);

    // Load jsPDF-autotable
    await loadScript(PDF_LIBS.autotable);

    // Load pdf-lib for merging
    await loadScript(PDF_LIBS.pdfLib);

    setPdfLibrariesLoaded(true);
    console.log('PDF libraries loaded successfully');
    return true;
  } catch (error) {
    console.error('Failed to load PDF libraries:', error);
    showToast('Failed to load PDF generation libraries', 'error');
    return false;
  }
}

/**
 * Load a script dynamically
 * @private
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Generate document bundle for current order
 */
export async function generateDocumentBundle() {
  const loaded = await ensurePDFLibrariesLoaded();
  if (!loaded) return;

  const orderID = getCurrentOrderID();
  if (!orderID) {
    showToast('Please select an order first', 'warning');
    return;
  }

  const shipments = getCachedShipments();
  if (!shipments || shipments.length === 0) {
    showToast('No shipments to generate documents for', 'warning');
    return;
  }

  showToast('Generating documents...', 'info');

  try {
    // Generate individual documents
    const docs = [];

    for (const shipment of shipments) {
      const invoice = await generateInvoicePDF(shipment);
      const packingSlip = await generatePackingSlipPDF(shipment);
      docs.push(invoice, packingSlip);
    }

    // Merge into single PDF
    const mergedPdf = await mergePDFs(docs);

    // Download
    const blob = new Blob([mergedPdf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Order_${orderID}_Documents.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Documents generated successfully!');
  } catch (error) {
    console.error('Error generating documents:', error);
    showToast('Error generating documents', 'error');
  }
}

/**
 * Generate invoice PDF
 * @param {Object} shipment
 * @returns {Promise<Uint8Array>}
 */
export async function generateInvoicePDF(shipment) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 105, 20, { align: 'center' });

  // Company info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Rogue Origin', 14, 35);
  doc.text('Southern Oregon', 14, 40);

  // Invoice details
  doc.setFont('helvetica', 'bold');
  doc.text(`Invoice #: ${shipment.invoiceNumber || 'N/A'}`, 140, 35);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${formatDate(shipment.shipmentDate)}`, 140, 40);

  // Line items table
  const lineItems = parseLineItems(shipment.lineItems);
  const tableData = lineItems.map(item => [
    item.strain || '',
    item.type || '',
    `${item.quantity} kg`,
    `(${(item.quantity * 2.205).toFixed(0)} lb)`,
    formatCurrency(item.unitPrice),
    formatCurrency(item.quantity * item.unitPrice)
  ]);

  doc.autoTable({
    startY: 55,
    head: [['Strain', 'Type', 'Qty (kg)', 'Qty (lb)', 'Unit Price', 'Total']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [102, 137, 113] }, // ro-green
    styles: { fontSize: 9 }
  });

  // Totals
  const finalY = doc.lastAutoTable.finalY + 10;

  doc.text(`Subtotal: ${formatCurrency(shipment.subTotal || 0)}`, 140, finalY);
  if (shipment.discount) {
    doc.text(`Discount: -${formatCurrency(shipment.discount)}`, 140, finalY + 5);
  }
  if (shipment.freightCost) {
    doc.text(`Freight: ${formatCurrency(shipment.freightCost)}`, 140, finalY + 10);
  }

  doc.setFont('helvetica', 'bold');
  doc.text(`Total: ${formatCurrency(shipment.totalAmount || 0)}`, 140, finalY + 20);

  return doc.output('arraybuffer');
}

/**
 * Generate packing slip PDF
 * @param {Object} shipment
 * @returns {Promise<Uint8Array>}
 */
export async function generatePackingSlipPDF(shipment) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Header
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('PACKING SLIP', 105, 20, { align: 'center' });

  // Shipment info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Shipment Date: ${formatDate(shipment.shipmentDate)}`, 14, 35);
  if (shipment.trackingNumber) {
    doc.text(`Tracking: ${shipment.trackingNumber}`, 14, 40);
  }
  if (shipment.carrier) {
    doc.text(`Carrier: ${shipment.carrier}`, 14, 45);
  }

  // Line items (no prices)
  const lineItems = parseLineItems(shipment.lineItems);
  const tableData = lineItems.map(item => [
    item.strain || '',
    item.type || '',
    `${item.quantity} kg`,
    `${(item.quantity * 2.205).toFixed(0)} lb`
  ]);

  doc.autoTable({
    startY: 55,
    head: [['Strain', 'Type', 'Qty (kg)', 'Qty (lb)']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [102, 137, 113] },
    styles: { fontSize: 10 }
  });

  // Dimensions if present
  const dims = shipment.dimensions || {};
  if (dims.weight || dims.length) {
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Package Dimensions:', 14, finalY);
    doc.setFont('helvetica', 'normal');

    let dimText = [];
    if (dims.length) dimText.push(`${dims.length}" x ${dims.width}" x ${dims.height}"`);
    if (dims.weight) dimText.push(`${dims.weight} lb`);

    doc.text(dimText.join(' | '), 14, finalY + 5);
  }

  return doc.output('arraybuffer');
}

/**
 * Merge multiple PDFs into one
 * @param {Array<ArrayBuffer>} pdfs
 * @returns {Promise<Uint8Array>}
 */
async function mergePDFs(pdfs) {
  const { PDFDocument } = window.PDFLib;
  const mergedPdf = await PDFDocument.create();

  for (const pdfBytes of pdfs) {
    const pdf = await PDFDocument.load(pdfBytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach(page => mergedPdf.addPage(page));
  }

  return mergedPdf.save();
}

/**
 * Parse line items (may be string or array)
 * @private
 */
function parseLineItems(lineItems) {
  if (!lineItems) return [];
  if (typeof lineItems === 'string') {
    try {
      return JSON.parse(lineItems);
    } catch (e) {
      return [];
    }
  }
  return lineItems;
}

/**
 * Generate single invoice for a shipment
 * @param {string} shipmentId
 */
export async function generateSingleInvoice(shipmentId) {
  const loaded = await ensurePDFLibrariesLoaded();
  if (!loaded) return;

  const shipments = getCachedShipments();
  const shipment = shipments.find(s => s.id === shipmentId);
  if (!shipment) {
    showToast('Shipment not found', 'error');
    return;
  }

  try {
    const pdfBytes = await generateInvoicePDF(shipment);
    downloadPDF(pdfBytes, `Invoice_${shipment.invoiceNumber || shipmentId}.pdf`);
    showToast('Invoice generated!');
  } catch (error) {
    console.error('Error generating invoice:', error);
    showToast('Error generating invoice', 'error');
  }
}

/**
 * Generate single packing slip for a shipment
 * @param {string} shipmentId
 */
export async function generateSinglePackingSlip(shipmentId) {
  const loaded = await ensurePDFLibrariesLoaded();
  if (!loaded) return;

  const shipments = getCachedShipments();
  const shipment = shipments.find(s => s.id === shipmentId);
  if (!shipment) {
    showToast('Shipment not found', 'error');
    return;
  }

  try {
    const pdfBytes = await generatePackingSlipPDF(shipment);
    downloadPDF(pdfBytes, `PackingSlip_${shipment.invoiceNumber || shipmentId}.pdf`);
    showToast('Packing slip generated!');
  } catch (error) {
    console.error('Error generating packing slip:', error);
    showToast('Error generating packing slip', 'error');
  }
}

/**
 * Download PDF bytes as file
 * @private
 */
function downloadPDF(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
