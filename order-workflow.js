(function (root, factory) {
  const workflow = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = workflow;
  if (root) root.AL_SHAMI_ORDER_WORKFLOW = workflow;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LABELS = Object.freeze({
    new: "New order",
    accepted: "Accepted · waiting for kitchen",
    preparing: "Being prepared",
    ready: "Ready for pickup / rider",
    out_for_delivery: "Out for delivery",
    completed: "Completed",
    rejected: "Rejected"
  });

  const ACTIONS = Object.freeze({
    accepted: "Accept order",
    rejected: "Reject order",
    preparing: "Send to kitchen",
    ready: "Mark ready",
    out_for_delivery: "Hand to rider"
  });

  function nextStatuses(order) {
    if (!order) return [];
    switch (String(order.status || "").toLowerCase()) {
      case "new": return ["accepted", "rejected"];
      case "accepted": return ["preparing"];
      case "preparing": return ["ready"];
      case "ready": return order.order_type === "delivery" ? ["out_for_delivery"] : [];
      default: return [];
    }
  }

  function canTransition(order, nextStatus, options) {
    if (!order || !nextStatus) return false;
    const receiptAuthorized = Boolean(options && options.receiptAuthorized);
    if (nextStatus === "completed") {
      if (!receiptAuthorized) return false;
      return order.order_type === "pickup"
        ? order.status === "ready"
        : order.order_type === "delivery" && order.status === "out_for_delivery";
    }
    return nextStatuses(order).includes(nextStatus);
  }

  function label(status) {
    return LABELS[String(status || "").toLowerCase()] || String(status || "");
  }

  function actionLabel(status) {
    return ACTIONS[String(status || "").toLowerCase()] || String(status || "");
  }

  return Object.freeze({ nextStatuses, canTransition, label, actionLabel });
});
