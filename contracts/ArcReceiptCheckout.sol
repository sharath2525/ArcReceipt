// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ArcReceiptCheckout is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum RequestStatus {
        Open,
        Paid,
        Cancelled
    }

    struct Request {
        address merchant;
        uint256 amount;
        uint256 expiresAt;
        RequestStatus status;
        address payer;
        uint256 paidAt;
    }

    error ZeroAmount();
    error ExpiryMustBeFuture();
    error ExpiryTooFar();
    error RequestNotFound();
    error RequestNotOpen();
    error RequestExpired();
    error SelfPayment();
    error NotMerchant();

    event RequestCreated(uint256 indexed id, address indexed merchant, uint256 amount, uint256 expiresAt);
    event RequestCancelled(uint256 indexed id, address indexed merchant);
    event PaymentRecorded(
        uint256 indexed id,
        address indexed merchant,
        address indexed payer,
        uint256 amount,
        uint256 paidAt
    );

    mapping(uint256 => Request) public requests;
    uint256 private _nextId;
    mapping(address => uint256[]) private _merchantRequests;

    address public immutable USDC;

    uint256 private constant MAX_EXPIRY_WINDOW = 30 days;
    uint256 private constant MAX_PAGE_SIZE = 20;

    constructor() {
        USDC = address(0x3600000000000000000000000000000000000000);
        _nextId = 1;
    }

    function createRequest(uint256 amount, uint256 expiresAt) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) revert ExpiryMustBeFuture();
        if (expiresAt > block.timestamp + MAX_EXPIRY_WINDOW) revert ExpiryTooFar();

        id = _nextId;
        _nextId = id + 1;

        requests[id] = Request({
            merchant: msg.sender,
            amount: amount,
            expiresAt: expiresAt,
            status: RequestStatus.Open,
            payer: address(0),
            paidAt: 0
        });

        _merchantRequests[msg.sender].push(id);

        emit RequestCreated(id, msg.sender, amount, expiresAt);
    }

    function cancelRequest(uint256 id) external {
        if (id == 0 || id >= _nextId) revert RequestNotFound();

        Request storage request = requests[id];

        if (msg.sender != request.merchant) revert NotMerchant();
        if (request.status != RequestStatus.Open) revert RequestNotOpen();

        request.status = RequestStatus.Cancelled;

        emit RequestCancelled(id, msg.sender);
    }

    function pay(uint256 id) external nonReentrant {
        if (id == 0 || id >= _nextId) revert RequestNotFound();

        Request storage request = requests[id];

        if (request.status != RequestStatus.Open) revert RequestNotOpen();
        if (block.timestamp >= request.expiresAt) revert RequestExpired();
        if (msg.sender == request.merchant) revert SelfPayment();

        address merchant = request.merchant;
        uint256 amount = request.amount;
        uint256 paidAt = block.timestamp;

        request.status = RequestStatus.Paid;
        request.payer = msg.sender;
        request.paidAt = paidAt;

        IERC20(USDC).safeTransferFrom(msg.sender, merchant, amount);

        emit PaymentRecorded(id, merchant, msg.sender, amount, paidAt);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return requests[id];
    }

    function getMerchantRequests(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage allIds = _merchantRequests[merchant];
        total = allIds.length;

        if (offset >= total) {
            return (new uint256[](0), total);
        }

        uint256 cappedLimit = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
        uint256 remaining = total - offset;
        uint256 length = cappedLimit < remaining ? cappedLimit : remaining;

        ids = new uint256[](length);
        for (uint256 i = 0; i < length; i++) {
            ids[i] = allIds[offset + i];
        }
    }
}
